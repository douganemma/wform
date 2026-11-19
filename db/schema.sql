PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS forms(id TEXT PRIMARY KEY,title TEXT NOT NULL,slug TEXT NOT NULL UNIQUE,description TEXT DEFAULT '',status TEXT NOT NULL DEFAULT 'draft',confirmation_message TEXT DEFAULT 'Thank you. Your registration has been received.',created_at TEXT DEFAULT(datetime('now')),updated_at TEXT DEFAULT(datetime('now')));
CREATE TABLE IF NOT EXISTS form_fields(id TEXT PRIMARY KEY,form_id TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,label TEXT NOT NULL,field_key TEXT NOT NULL,type TEXT NOT NULL,required INTEGER DEFAULT 0,options_json TEXT DEFAULT '[]',help_text TEXT DEFAULT '',position INTEGER DEFAULT 0,UNIQUE(form_id,field_key));
CREATE TABLE IF NOT EXISTS submissions(id TEXT PRIMARY KEY,form_id TEXT NOT NULL REFERENCES forms(id),source TEXT NOT NULL,contact_phone TEXT,contact_name TEXT,status TEXT DEFAULT 'complete',consent INTEGER DEFAULT 0,created_at TEXT DEFAULT(datetime('now')),updated_at TEXT DEFAULT(datetime('now')));
CREATE INDEX IF NOT EXISTS submissions_phone ON submissions(contact_phone);
CREATE TABLE IF NOT EXISTS responses(id TEXT PRIMARY KEY,submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,field_id TEXT NOT NULL REFERENCES form_fields(id),value_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,wa_id TEXT NOT NULL,form_id TEXT NOT NULL REFERENCES forms(id),submission_id TEXT REFERENCES submissions(id),current_field_id TEXT,state TEXT DEFAULT 'active',last_message_id TEXT,updated_at TEXT DEFAULT(datetime('now')),UNIQUE(wa_id,form_id));
CREATE TABLE IF NOT EXISTS wa_messages(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,direction TEXT NOT NULL,message_type TEXT,message_id TEXT UNIQUE,body TEXT,created_at TEXT DEFAULT(datetime('now')));
CREATE TABLE IF NOT EXISTS audit_log(id TEXT PRIMARY KEY,actor TEXT,action TEXT NOT NULL,entity_type TEXT,entity_id TEXT,metadata_json TEXT DEFAULT '{}',created_at TEXT DEFAULT(datetime('now')));
INSERT OR IGNORE INTO forms(id,title,slug,description,status) VALUES('starter-registration','Starter registration','register','A reusable registration form.','published');
INSERT OR IGNORE INTO form_fields(id,form_id,label,field_key,type,required,options_json,position) VALUES
('f-name','starter-registration','Full name','full_name','text',1,'[]',0),
('f-title','starter-registration','Title','title','single_select',1,'["Mr","Mrs","Ms","Dr","Other"]',1),
('f-phone','starter-registration','WhatsApp / phone number','phone','phone',1,'[]',2),
('f-email','starter-registration','Email address','email','email',0,'[]',3),
('f-interests','starter-registration','Areas of interest','interests','multi_select',0,'["Training","Events","Volunteering","Partnerships"]',4);
CREATE TABLE IF NOT EXISTS wa_delivery_events(
 id TEXT PRIMARY KEY, message_id TEXT NOT NULL, status TEXT NOT NULL,
 recipient_id TEXT, event_timestamp TEXT, error_json TEXT DEFAULT '{}',
 created_at TEXT DEFAULT(datetime('now'))
);
CREATE INDEX IF NOT EXISTS wa_delivery_message ON wa_delivery_events(message_id);
