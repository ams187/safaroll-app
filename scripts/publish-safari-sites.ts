import { Database } from 'bun:sqlite';
import { open } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

// --prepare is local only. --apply explicitly publishes using an authorized service key.
const mode=process.argv[2];
if(!['--prepare','--apply'].includes(mode)) throw new Error('Use --prepare or --apply');
const url=process.env.EXPO_PUBLIC_SUPABASE_URL;
const secret=process.env.SUPABASE_SECRET_KEY;
if(mode==='--apply' && (!url || !secret)) throw new Error('EXPO_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY required.');
const remote=mode==='--apply' ? createClient(url!,secret!,{auth:{persistSession:false}}) : null;
const db=new Database('.cache/zootierliste/catalog.sqlite',{readonly:true});
const output=mode==='--prepare' ? await open('.cache/zootierliste/safari-sites.jsonl','w') : null;
let count=0;
try {
  // Snapshot while the collector may continue writing via WAL.
  db.run('BEGIN');
  const rows=db.query('SELECT * FROM zoos WHERE closed=0 AND retrieved_at IS NOT NULL AND latitude IS NOT NULL ORDER BY id').all() as {
    id:string; name:string; country:string; latitude:number; longitude:number; retrieved_at:string; revision_note:string|null;
  }[];
  for(let offset=0;offset<rows.length;offset+=25) {
    const sites=rows.slice(offset,offset+25).map(row=>({id:row.id,name:row.name,country:row.country,
      latitude:row.latitude,longitude:row.longitude,inventoryAt:row.retrieved_at,revisionNote:row.revision_note,
      species:(db.query(`SELECT DISTINCT t.scientific_name AS name FROM taxa t JOIN holdings h ON h.taxon_id=t.id
        WHERE h.zoo_id=? AND t.scientific_name IS NOT NULL`).all(row.id) as {name:string}[]).map(t=>t.name),
    }));
    if(remote) {
      const {error}=await remote.rpc('safari_import_sites',{p_sites:sites});
      if(error) throw new Error(error.message);
    } else for(const site of sites) await output!.write(JSON.stringify(site)+'\n');
    count+=sites.length;
  }
  db.run('COMMIT');
  console.log(`${count} parsed zoo inventories ${remote?'published':'prepared locally'}. This is the imported subset, NOT the full world index.`);
} finally { db.close(); await output?.close(); }
