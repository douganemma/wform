const j=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"content-type":"application/json","cache-control":"no-store"}});
const uid=()=>crypto.randomUUID(), dec=s=>{try{return JSON.parse(s)}catch{return null}}, slug=s=>String(s||"").toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
async function isAdmin(req,env){
 const token=req.headers.get("Cf-Access-Jwt-Assertion");
 if(!token||!env.ACCESS_TEAM_DOMAIN||!env.ACCESS_AUD)return false;
 try{
  const parts=token.split(".");
  if(parts.length!==3)return false;
  const b64url=x=>{const s=x.replace(/-/g,"+").replace(/_/g,"/");return atob(s+"=".repeat((4-s.length%4)%4))};
  const head=JSON.parse(b64url(parts[0])),pay=JSON.parse(b64url(parts[1]));
  const audiences=Array.isArray(pay.aud)?pay.aud:[pay.aud];
  if(!audiences.includes(env.ACCESS_AUD)||pay.iss!=="https://"+env.ACCESS_TEAM_DOMAIN||!Number.isFinite(pay.exp)||pay.exp*1000<Date.now())return false;
  const response=await fetch("https://"+env.ACCESS_TEAM_DOMAIN+"/cdn-cgi/access/certs");
  if(!response.ok)return false;
  const cert=await response.json(),jwk=cert.keys?.find(k=>k.kid===head.kid);
  if(!jwk)return false;
  const key=await crypto.subtle.importKey("jwk",jwk,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
  const sig=Uint8Array.from(b64url(parts[2]),c=>c.charCodeAt(0));
  return await crypto.subtle.verify("RSASSA-PKCS1-v1_5",key,sig,new TextEncoder().encode(parts[0]+"."+parts[1]));
 }catch{return false}
}
const getFields=async(db,id)=>(await db.prepare("SELECT * FROM form_fields WHERE form_id=? ORDER BY position").bind(id).all()).results||[];
const send=async(env,to,payload)=>{if(!env.WA_PHONE_NUMBER_ID||!env.WA_ACCESS_TOKEN)throw Error("WhatsApp credentials not configured");const r=await fetch("https://graph.facebook.com/"+(env.WA_GRAPH_VERSION||"v27.0")+"/"+env.WA_PHONE_NUMBER_ID+"/messages",{method:"POST",headers:{authorization:"Bearer "+env.WA_ACCESS_TOKEN,"content-type":"application/json"},body:JSON.stringify({messaging_product:"whatsapp",to,...payload})});const d=await r.json();if(!r.ok)throw Error(d.error?.message||"WhatsApp API error");return d};
async function signature(req,raw,secret){const h=req.headers.get("x-hub-signature-256")||"";if(!secret||!h.startsWith("sha256="))return false;const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]),d=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(raw))),hex=[...d].map(x=>x.toString(16).padStart(2,"0")).join("");return hex===h.slice(7)}
async function wa(req,env){
 const u=new URL(req.url);
 if(req.method==="GET"){
  if(u.searchParams.get("hub.mode")==="subscribe"&&u.searchParams.get("hub.verify_token")===env.WA_VERIFY_TOKEN)return new Response(u.searchParams.get("hub.challenge")||"");
  return new Response("Forbidden",{status:403});
 }
 const raw=await req.text();
 if(!await signature(req,raw,env.META_APP_SECRET))return new Response("Invalid signature",{status:401});
 const event=dec(raw);
 const changes=event?.entry?.flatMap(x=>x.changes||[])||[];
 const value=changes.find(x=>x.field==="messages")?.value;
 if(!value)return new Response("EVENT_RECEIVED");
 for(const status of value.statuses||[]){
  await env.DB.prepare("INSERT INTO wa_delivery_events(id,message_id,status,recipient_id,event_timestamp,error_json) VALUES(?,?,?,?,?,?)").bind(uid(),status.id,status.status,status.recipient_id||null,status.timestamp||null,JSON.stringify(status.errors||[])).run();
 }
 for(const m of value.messages||[]){
  const phone=m.from;
  const interactive=m.interactive?.button_reply||m.interactive?.list_reply;
  const text=String(m.text?.body||m.button?.text||interactive?.title||"").trim();
  const messageId=m.id;
  if(!phone||!text)continue;
  if(messageId&&await env.DB.prepare("SELECT id FROM wa_messages WHERE message_id=?").bind(messageId).first())continue;
  if(/^forms$/i.test(text)){
   const available=(await env.DB.prepare("SELECT title,slug FROM forms WHERE status='published' ORDER BY created_at").all()).results||[];
   const list=available.map(x=>"• "+x.title+" — send START "+x.slug).join("\n");
   await send(env,phone,{type:"text",text:{body:available.length?"Available registrations:\n"+list+"\n\nSend START followed by the form code to begin.":"There are no published forms available right now."}});
   continue;
  }
  const startMatch=text.match(/^start(?:\s+([a-z0-9-]+))?$/i);
  let c=null,form=null;
  if(startMatch&&startMatch[1])form=await env.DB.prepare("SELECT * FROM forms WHERE slug=? AND status='published'").bind(startMatch[1].toLowerCase()).first();
  else{
   c=await env.DB.prepare("SELECT * FROM conversations WHERE wa_id=? ORDER BY updated_at DESC LIMIT 1").bind(phone).first();
   if(c)form=await env.DB.prepare("SELECT * FROM forms WHERE id=? AND status='published'").bind(c.form_id).first();
   if(!form)form=await env.DB.prepare("SELECT * FROM forms WHERE status='published' ORDER BY created_at LIMIT 1").first();
  }
  if(!form){await send(env,phone,{type:"text",text:{body:startMatch&&startMatch[1]?"I couldn't find that published form. Send FORMS to see available registrations.":"Registrations are unavailable right now. Send FORMS to check available registrations."}});continue;}
  if(c&&c.form_id!==form.id)c=null;
  if(!c)c=await env.DB.prepare("SELECT * FROM conversations WHERE wa_id=? AND form_id=?").bind(phone,form.id).first();
  const deliver=async(payload,body)=>{
   try{
    const result=await send(env,phone,payload);
    const outboundId=result?.messages?.[0]?.id||null;
    if(c)await env.DB.prepare("INSERT INTO wa_messages(id,conversation_id,direction,message_type,message_id,body) VALUES(?,?,'out',?,?,?)").bind(uid(),c.id,payload.type||"text",outboundId,body||payload.text?.body||"").run();
    return result;
   }catch(error){console.error("WFORM_WHATSAPP_SEND_ERROR",JSON.stringify({to:phone,error:String(error?.message||error),at:new Date().toISOString()}));throw error;}
  };
  const say=body=>deliver({type:"text",text:{body}},body);
  if(/^stop$/i.test(text)){
   if(c)await env.DB.prepare("UPDATE conversations SET state='stopped' WHERE id=?").bind(c.id).run();
   await say("You have opted out. You will not receive registration messages. Send START whenever you want to begin again.");
   continue;
  }
  if(!c||startMatch||/^hello$|^hi$|^register$/i.test(text)||c.state==="stopped"||c.state==="complete"){
   const sid=uid(),cid=uid();
   await env.DB.prepare("INSERT INTO submissions(id,form_id,source,contact_phone,status) VALUES(?,?,'whatsapp',?,'incomplete')").bind(sid,form.id,phone).run();
   await env.DB.prepare("INSERT INTO conversations(id,wa_id,form_id,submission_id,state) VALUES(?,?,?,?,'awaiting_consent') ON CONFLICT(wa_id,form_id) DO UPDATE SET submission_id=excluded.submission_id,state='awaiting_consent',current_field_id=NULL,updated_at=datetime('now')").bind(cid,phone,form.id,sid).run();
   c=await env.DB.prepare("SELECT * FROM conversations WHERE wa_id=? AND form_id=?").bind(phone,form.id).first();
   if(messageId)await env.DB.prepare("INSERT OR IGNORE INTO wa_messages(id,conversation_id,direction,message_type,message_id,body) VALUES(?,?,'in',?,?,?)").bind(uid(),c.id,m.type||"text",messageId,text).run();
   await say("Welcome to "+form.title+". I will guide you through the registration one question at a time.\n\nReply YES to agree that your answers and phone number may be used for this registration. Reply NO to cancel. You can type SKIP to skip a question, BACK to return to the previous question, REPEAT to hear a question again, HELP for instructions, or STOP to opt out. Send FORMS to see other published forms.");
   continue;
  }
  if(messageId)await env.DB.prepare("INSERT OR IGNORE INTO wa_messages(id,conversation_id,direction,message_type,message_id,body) VALUES(?,?,'in',?,?,?)").bind(uid(),c.id,m.type||"text",messageId,text).run();
  if(c.state==="stopped"){await say("You are opted out. Send START to begin a new registration.");continue;}
  let justConsented=false;
  if(c.state==="awaiting_consent"){
   if(/^no$|^cancel$/i.test(text)){
    await env.DB.prepare("UPDATE conversations SET state='stopped' WHERE id=?").bind(c.id).run();
    await say("Your registration has been cancelled. Send START if you change your mind.");
    continue;
   }
   if(!/^yes$|^agree$|^i agree$/i.test(text)){await say("Please reply YES to continue or NO to cancel.");continue;}
   await env.DB.prepare("UPDATE submissions SET consent=1 WHERE id=?").bind(c.submission_id).run();
   await env.DB.prepare("UPDATE conversations SET state='active' WHERE id=?").bind(c.id).run();
   c={...c,state:"active"};
   justConsented=true;
  }
  if(c.state!=="active"){await say("This registration is already complete. Send START to submit another registration.");continue;}
  const fs=await getFields(env.DB,form.id);
  if(justConsented&&fs.length){
   const first=fs[0],opts=dec(first.options_json)||[];
   await env.DB.prepare("UPDATE conversations SET current_field_id=?,updated_at=datetime('now') WHERE id=?").bind(first.id,c.id).run();
   let prompt="Thank you. Consent recorded. Let us begin: "+first.label+(first.required?" (required)":" (optional)");
   if(first.help_text)prompt+=". "+first.help_text;
   if(opts.length)prompt+=" Options: "+opts.map((x,i)=>(i+1)+". "+x).join("; ")+(first.type==="multi_select"?". For multiple answers, separate option numbers with commas.":"");
   prompt+=". Type SKIP to skip, BACK to go back, REPEAT to hear this again, or HELP for commands.";
   let payload={type:"text",text:{body:prompt}};
   if(["single_select","select"].includes(first.type)&&opts.length>0&&opts.length<=3)payload={type:"interactive",interactive:{type:"button",body:{text:prompt},action:{buttons:opts.map((x,i)=>({type:"reply",reply:{id:"choice_"+(i+1),title:String(x).slice(0,20)}}))}}};
   else if(["single_select","select"].includes(first.type)&&opts.length>3&&opts.length<=10){payload={type:"interactive",interactive:{type:"list",body:{text:prompt},action:{button:"Choose",sections:[{title:"Options",rows:opts.map((x,i)=>({id:"choice_"+(i+1),title:String(x).slice(0,24)}))}]}}};}
   await deliver(payload,prompt);continue;
  }
  if(!fs.length){await env.DB.prepare("UPDATE submissions SET status='complete',updated_at=datetime('now') WHERE id=?").bind(c.submission_id).run();await env.DB.prepare("UPDATE conversations SET state='complete',current_field_id=NULL WHERE id=?").bind(c.id).run();await say(form.confirmation_message||"Thank you. Your registration is complete.");continue;}
  let idx=c.current_field_id?fs.findIndex(x=>x.id===c.current_field_id):0;
  if(idx<0)idx=0;
  const command=text.toLowerCase().trim();
  if(["help","menu","commands"].includes(command)){
   await say("Here are the chat commands:\nSKIP — skip this question, even if it is marked required.\nBACK — return to the previous question.\nREPEAT — show this question again.\nCANCEL — cancel this registration.\nSTART — start a fresh registration.\nSTOP — opt out.\nYou can also reply normally or tap the choices shown.");
   // Keep the current question active and repeat it below.
  }else if(["cancel","quit","exit"].includes(command)){
   await env.DB.prepare("UPDATE conversations SET state='stopped' WHERE id=?").bind(c.id).run();
   await env.DB.prepare("UPDATE submissions SET status='cancelled',updated_at=datetime('now') WHERE id=?").bind(c.submission_id).run();
   await say("Your registration has been cancelled. Send START whenever you want to begin again.");
   continue;
  }else if(command==="back"){
   if(idx<=0){await say("You are already at the first question.");}
   else{
    idx--;
    const previous=fs[idx];
    await env.DB.prepare("DELETE FROM responses WHERE submission_id=? AND field_id=?").bind(c.submission_id,previous.id).run();
    await env.DB.prepare("UPDATE conversations SET current_field_id=?,updated_at=datetime('now') WHERE id=?").bind(previous.id,c.id).run();
   }
  }else if(command==="repeat"){
   // Repeat the current question without saving an answer.
  }else if(idx<fs.length){
   const f=fs[idx],opts=dec(f.options_json)||[];
   if(command==="skip"){
    await env.DB.prepare("DELETE FROM responses WHERE submission_id=? AND field_id=?").bind(c.submission_id,f.id).run();
    await env.DB.prepare("INSERT INTO responses(id,submission_id,field_id,value_json) VALUES(?,?,?,?)").bind(uid(),c.submission_id,f.id,JSON.stringify("__SKIPPED__")).run();
    idx++;
   }else{
    let answer=text;
    if(["single_select","select"].includes(f.type)){
     const n=Number(text.replace(/^choice_/,""));
     const choice=opts.find(x=>String(x).toLowerCase()===text.toLowerCase())||opts[n-1];
     if(!choice){await say("Please choose one of the options shown, or type SKIP.\n"+opts.map((x,i)=>(i+1)+". "+x).join("\n"));continue;}
     answer=choice;
    }
    if(f.type==="multi_select"){
     const nums=text.split(",").map(x=>Number(x.trim().replace(/^choice_/,"")));
     const selected=nums.map(n=>opts[n-1]).filter(Boolean);
     if(!selected.length){await say("Choose option numbers separated by commas, or type SKIP:\n"+opts.map((x,i)=>(i+1)+". "+x).join("\n"));continue;}
     answer=selected;
    }
    if(answer===""&&f.required){await say("This answer is required. Please enter an answer or type SKIP.");continue;}
    await env.DB.prepare("DELETE FROM responses WHERE submission_id=? AND field_id=?").bind(c.submission_id,f.id).run();
    await env.DB.prepare("INSERT INTO responses(id,submission_id,field_id,value_json) VALUES(?,?,?,?)").bind(uid(),c.submission_id,f.id,JSON.stringify(answer)).run();
    idx++;
   }
  }
  if(idx>=fs.length){
   await env.DB.prepare("UPDATE submissions SET status='complete',updated_at=datetime('now') WHERE id=?").bind(c.submission_id).run();
   await env.DB.prepare("UPDATE conversations SET state='complete',current_field_id=NULL,updated_at=datetime('now') WHERE id=?").bind(c.id).run();
   await say(form.confirmation_message||"Thank you. Your registration is complete.");
   continue;
  }
  const f=fs[idx],opts=dec(f.options_json)||[];
  await env.DB.prepare("UPDATE conversations SET current_field_id=?,updated_at=datetime('now') WHERE id=?").bind(f.id,c.id).run();
  let prompt=f.label+(f.required?" (required)":" (optional)");
  if(f.help_text)prompt+="\n"+f.help_text;
  if(opts.length)prompt+="\n"+opts.map((x,i)=>(i+1)+". "+x).join("\n")+(f.type==="multi_select"?"\nFor multiple answers, separate option numbers with commas.":"");
  prompt+="\n\nType SKIP to skip, BACK to go back, REPEAT to hear this again, or HELP for commands.";
  let payload={type:"text",text:{body:prompt}};
  if(["single_select","select"].includes(f.type)&&opts.length>0&&opts.length<=3){
   payload={type:"interactive",interactive:{type:"button",body:{text:prompt},action:{buttons:opts.map((x,i)=>({type:"reply",reply:{id:"choice_"+(i+1),title:String(x).slice(0,20)}}))}}};
  }else if(["single_select","select"].includes(f.type)&&opts.length>3&&opts.length<=10){
   payload={type:"interactive",interactive:{type:"list",body:{text:prompt},action:{button:"Choose",sections:[{title:"Options",rows:opts.map((x,i)=>({id:"choice_"+(i+1),title:String(x).slice(0,24)}))}]}}};
  }
  await deliver(payload,prompt);
 }
 return new Response("EVENT_RECEIVED");
}
export default {async fetch(req,env){
 const u=new URL(req.url),p=u.pathname;if(p==="/api/health")return j({ok:true,app:"W-Form"});if(p==="/webhooks/whatsapp")return wa(req,env);
 if((p==="/login"||p==="/api/admin/login")&&req.method==="GET"){
  if(!env.ACCESS_TEAM_DOMAIN||!env.ACCESS_AUD)return j({error:"Cloudflare Access settings are missing"},500);
  const target=new URL("https://"+env.ACCESS_TEAM_DOMAIN+"/cdn-cgi/access/login/"+encodeURIComponent(env.ACCESS_AUD));
  target.searchParams.set("redirect_url",new URL("/",req.url).toString());
  return Response.redirect(target.toString(),302);
 }
 if(p.startsWith("/api/admin")&&!await isAdmin(req,env))return j({error:"Admin access required. Configure Cloudflare Access."},401);
 try{
 if(p==="/api/public/forms"&&req.method==="GET")return j((await env.DB.prepare("SELECT id,title,slug,description FROM forms WHERE status='published'").all()).results);
 let pub=p.match(/^\/api\/public\/forms\/([^/]+)$/);if(pub&&req.method==="GET"){const f=await env.DB.prepare("SELECT * FROM forms WHERE slug=? AND status='published'").bind(pub[1]).first();return f?j({...f,fields:await getFields(env.DB,f.id)}):j({error:"Not found"},404)}
 if(p==="/api/public/submissions"&&req.method==="POST"){const b=await req.json(),f=await env.DB.prepare("SELECT * FROM forms WHERE slug=? AND status='published'").bind(b.slug).first();if(!f)return j({error:"Form not found"},404);if(!b.consent)return j({error:"Consent is required"},400);const fs=await getFields(env.DB,f.id),vals=b.values||{};for(const x of fs){const v=vals[x.field_key];if(x.required&&(v===undefined||v===null||v===""))return j({error:x.label+" is required"},400);if(v!==undefined&&["single_select","select","multi_select"].includes(x.type)){const a=Array.isArray(v)?v:[v],opts=dec(x.options_json)||[];if(a.some(z=>!opts.includes(z)))return j({error:"Invalid choice for "+x.label},400)}}const sid=uid();await env.DB.prepare("INSERT INTO submissions(id,form_id,source,contact_phone,contact_name,consent) VALUES(?,?,'web',?,?,1)").bind(sid,f.id,vals.phone||null,vals.full_name||null).run();for(const x of fs)if(Object.hasOwn(vals,x.field_key))await env.DB.prepare("INSERT INTO responses(id,submission_id,field_id,value_json) VALUES(?,?,?,?)").bind(uid(),sid,x.id,JSON.stringify(vals[x.field_key])).run();return j({ok:true,id:sid,message:f.confirmation_message},201)}
 if(p==="/api/admin/overview"){const a=await env.DB.prepare("SELECT COUNT(*) n FROM submissions").first(),b=await env.DB.prepare("SELECT COUNT(*) n FROM forms WHERE status='published'").first(),c=await env.DB.prepare("SELECT COUNT(*) n FROM submissions WHERE date(created_at)=date('now')").first();return j({submissions:a.n,forms:b.n,today:c.n})}
 if(p==="/api/admin/forms"&&req.method==="GET")return j((await env.DB.prepare("SELECT f.*,(SELECT COUNT(*) FROM submissions s WHERE s.form_id=f.id) submissions FROM forms f ORDER BY created_at DESC").all()).results);
 if(p==="/api/admin/forms"&&req.method==="POST"){const b=await req.json(),fid=uid(),s=slug(b.slug||b.title);if(!b.title||!s)return j({error:"Title is required"},400);await env.DB.prepare("INSERT INTO forms(id,title,slug,description,status) VALUES(?,?,?,?,?)").bind(fid,b.title,s,b.description||"",b.status||"draft").run();return j({id:fid,slug:s},201)}
 let fr=p.match(/^\/api\/admin\/forms\/([^/]+)$/);if(fr&&req.method==="GET"){const f=await env.DB.prepare("SELECT * FROM forms WHERE id=?").bind(fr[1]).first();return f?j({...f,fields:await getFields(env.DB,f.id)}):j({error:"Not found"},404)}
 if(fr&&req.method==="PUT"){const b=await req.json();await env.DB.prepare("UPDATE forms SET title=?,description=?,status=?,confirmation_message=?,updated_at=datetime('now') WHERE id=?").bind(b.title,b.description||"",b.status,b.confirmation_message||"Thank you for registering.",fr[1]).run();if(Array.isArray(b.fields)){await env.DB.prepare("DELETE FROM form_fields WHERE form_id=?").bind(fr[1]).run();for(let i=0;i<b.fields.length;i++){const f=b.fields[i];await env.DB.prepare("INSERT INTO form_fields(id,form_id,label,field_key,type,required,options_json,help_text,position) VALUES(?,?,?,?,?,?,?,?,?)").bind(f.id||uid(),fr[1],f.label,slug(f.field_key||f.label).replace(/-/g,"_"),f.type,f.required?1:0,JSON.stringify(f.options||[]),f.help_text||"",i).run()}}return j({ok:true})}
 if(p==="/api/admin/submissions"&&req.method==="GET"){const q=u.searchParams.get("q")||"",f=u.searchParams.get("form")||"",rows=(await env.DB.prepare("SELECT s.*,f.title form_title FROM submissions s JOIN forms f ON f.id=s.form_id WHERE (?='' OR s.form_id=?) AND (?='' OR s.contact_phone LIKE ? OR s.contact_name LIKE ?) ORDER BY s.created_at DESC LIMIT 1000").bind(f,f,q,"%"+q+"%","%"+q+"%").all()).results,out=[];for(const s of rows){const r=(await env.DB.prepare("SELECT ff.label,r.value_json FROM responses r JOIN form_fields ff ON ff.id=r.field_id WHERE r.submission_id=?").bind(s.id).all()).results;s.answers=Object.fromEntries(r.map(x=>[x.label,dec(x.value_json)]));out.push(s)}return j(out)}
 let sr=p.match(/^\/api\/admin\/submissions\/([^/]+)$/);if(sr&&req.method==="DELETE"){await env.DB.prepare("DELETE FROM conversations WHERE submission_id=?").bind(sr[1]).run();await env.DB.prepare("DELETE FROM submissions WHERE id=?").bind(sr[1]).run();return j({ok:true})}
 if(p==="/api/admin/export.csv"){
  const rows=(await env.DB.prepare("SELECT s.*,f.title form_title FROM submissions s JOIN forms f ON f.id=s.form_id ORDER BY s.created_at DESC").all()).results;
  const headers=["id","form","source","name","phone","status","consent","created_at"],extra=(await env.DB.prepare("SELECT DISTINCT ff.label FROM form_fields ff JOIN responses r ON r.field_id=ff.id ORDER BY ff.label").all()).results.map(x=>x.label);
  const esc=x=>'"'+String(x??"").replace(/"/g,'""')+'"',lines=[headers.concat(extra).map(esc).join(",")];
  for(const s of rows){const ans=(await env.DB.prepare("SELECT ff.label,r.value_json FROM responses r JOIN form_fields ff ON ff.id=r.field_id WHERE r.submission_id=?").bind(s.id).all()).results,values=Object.fromEntries(ans.map(x=>[x.label,dec(x.value_json)]));lines.push([s.id,s.form_title,s.source,s.contact_name,s.contact_phone,s.status,s.consent,s.created_at,...extra.map(k=>Array.isArray(values[k])?values[k].join("; "):values[k])].map(esc).join(","))}
  return new Response(lines.join("\r\n"),{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":'attachment; filename="wform-submissions.csv"',"cache-control":"no-store"}})
 }
 if(p==="/api/admin/whatsapp/test"&&req.method==="POST"){
  const last=await env.DB.prepare("SELECT c.id conversation_id,c.wa_id FROM wa_messages m JOIN conversations c ON c.id=m.conversation_id WHERE m.direction='in' ORDER BY m.created_at DESC LIMIT 1").first();
  if(!last)return j({error:"No incoming WhatsApp sender is recorded yet."},404);
  const body="Hi, this is a test message from W-Form. Please reply to confirm the WhatsApp connection is working.";
  try{
   const result=await send(env,last.wa_id,{type:"text",text:{body}});
   const messageId=result?.messages?.[0]?.id||null;
   await env.DB.prepare("INSERT INTO wa_messages(id,conversation_id,direction,message_type,message_id,body) VALUES(?,?,'out','text',?,?)").bind(uid(),last.conversation_id,messageId,body).run();
   return j({ok:true,recipient:last.wa_id,message_id:messageId,meta_accepted:true});
  }catch(error){console.error("WFORM_WHATSAPP_TEST_ERROR",String(error?.message||error));return j({ok:false,error:String(error?.message||error),meta_accepted:false},502)}
 }
 if(p==="/api/admin/whatsapp/inbox"&&req.method==="GET"){
  const rows=await env.DB.prepare("SELECT c.id,c.wa_id,c.state,c.updated_at,s.contact_name,f.title form_title,(SELECT body FROM wa_messages WHERE conversation_id=c.id ORDER BY created_at DESC LIMIT 1) last_message,(SELECT direction FROM wa_messages WHERE conversation_id=c.id ORDER BY created_at DESC LIMIT 1) last_direction,(SELECT created_at FROM wa_messages WHERE conversation_id=c.id ORDER BY created_at DESC LIMIT 1) last_message_at,(SELECT COUNT(*) FROM wa_messages WHERE conversation_id=c.id AND direction='in') incoming_count FROM conversations c LEFT JOIN submissions s ON s.id=c.submission_id LEFT JOIN forms f ON f.id=c.form_id ORDER BY COALESCE((SELECT created_at FROM wa_messages WHERE conversation_id=c.id ORDER BY created_at DESC LIMIT 1),c.updated_at) DESC").all();
  return j(rows.results||[]);
 }
 const inboxMatch=p.match(/^\/api\/admin\/whatsapp\/inbox\/([^/]+)$/);
 if(inboxMatch&&req.method==="GET"){
  const conversationId=decodeURIComponent(inboxMatch[1]);
  const conversation=await env.DB.prepare("SELECT c.id,c.wa_id,c.state,s.contact_name,f.title form_title FROM conversations c LEFT JOIN submissions s ON s.id=c.submission_id LEFT JOIN forms f ON f.id=c.form_id WHERE c.id=?").bind(conversationId).first();
  if(!conversation)return j({error:"Conversation not found"},404);
  const rows=await env.DB.prepare("SELECT id,direction,message_type,body,created_at,message_id FROM wa_messages WHERE conversation_id=? ORDER BY created_at ASC,id ASC").bind(conversationId).all();
  return j({conversation,messages:rows.results||[]});
 }
 if(inboxMatch&&req.method==="POST"){
  const conversationId=decodeURIComponent(inboxMatch[1]);
  const conversation=await env.DB.prepare("SELECT * FROM conversations WHERE id=?").bind(conversationId).first();
  if(!conversation)return j({error:"Conversation not found"},404);
  const input=await req.json();const body=String(input.body||"").trim();
  if(!body)return j({error:"Message cannot be empty"},400);
  try{
   const result=await send(env,conversation.wa_id,{type:"text",text:{body}});
   const messageId=result?.messages?.[0]?.id||null;
   await env.DB.prepare("INSERT INTO wa_messages(id,conversation_id,direction,message_type,message_id,body) VALUES(?,?,'out','text',?,?)").bind(uid(),conversationId,messageId,body).run();
   return j({ok:true,message_id:messageId});
  }catch(error){console.error("WFORM_WHATSAPP_REPLY_ERROR",String(error?.message||error));return j({error:String(error?.message||error)},502)}
 }
 if(p==="/api/admin/whatsapp/status")return j({configured:!!(env.WA_PHONE_NUMBER_ID&&env.WA_ACCESS_TOKEN&&env.WA_VERIFY_TOKEN&&env.META_APP_SECRET),webhook:"/webhooks/whatsapp"});
 return env.ASSETS ? env.ASSETS.fetch(req) : j({error:"Not found"},404)
 }catch(e){return j({error:e.message||"Server error"},500)}
}};
