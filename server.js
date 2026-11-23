const express=require('express'),cors=require('cors'),multer=require('multer'),archiver=require('archiver'),AdmZip=require('adm-zip'),{PNG}=require('pngjs'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const app=express();app.use(cors());
const upload=multer({dest:'tmp/',limits:{fileSize:25*1024*1024}});
const KEY=process.env.GEMINI_API_KEY,MODEL=process.env.GEMINI_MODEL||'gemini-2.5-flash';
fs.mkdirSync('out',{recursive:true});
app.use('/downloads',express.static('out'));

// Crystal orb = shared brain. Every bot reads it before a task and adds one lesson after.
// Note: Render's free disk resets on redeploy; move this to Supabase later to keep it forever.
const BRAIN='brain.json';
const readBrain=()=>{try{return JSON.parse(fs.readFileSync(BRAIN))}catch{return[]}};
const learn=(bot,lesson)=>{if(!lesson)return;const b=readBrain();b.push({bot,lesson:String(lesson).slice(0,300),at:new Date().toISOString()});fs.writeFileSync(BRAIN,JSON.stringify(b.slice(-200)))};
app.get('/api/brain',(q,r)=>r.json(readBrain().reverse()));

async function gemini(prompt){
  if(!KEY)throw new Error('GEMINI_API_KEY is not set on the server.');
  const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':KEY},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseMimeType:'application/json'}})});
  const j=await r.json();if(!r.ok)throw new Error(j.error?.message||'AI request failed');
  return JSON.parse(j.candidates[0].content.parts[0].text);
}
const TEXT=/\.(txt|md|js|ts|json|html|css|py|java|kt|xml|yml|yaml|csv|c|cpp|cs|gd|lua)$/i;
function readInput(f){
  let out='';
  if(/\.zip$/i.test(f.originalname)){for(const e of new AdmZip(f.path).getEntries())if(!e.isDirectory&&TEXT.test(e.entryName)&&out.length<60000)out+=`\n--- ${e.entryName} ---\n${e.getData().toString('utf8')}`;}
  else out=fs.readFileSync(f.path,'utf8');
  return out.slice(0,60000);
}
function zipTo(id,files){return new Promise((ok,no)=>{const o=fs.createWriteStream(`out/${id}.zip`),a=archiver('zip');o.on('close',()=>ok(`/downloads/${id}.zip`));a.on('error',no);a.pipe(o);files.forEach(f=>a.append(f.data,{name:f.name}));a.finalize()})}
const safe=p=>path.normalize(String(p)).replace(/^(\.\.[\/\\])+/,'').replace(/^[\/\\]+/,'');

async function coder(msg,input,brain,id){
  const o=await gemini(`You are Coder Bot in an office of AI bots.\nShared brain (lessons from all bots):\n${brain||'(empty)'}\n\nTask: ${msg}\n\nUploaded files:\n${input||'(none)'}\n\nReturn JSON: {"summary":string,"files":[{"path":string,"content":string}],"lesson":string}. Return only files that are new or changed. "lesson" is one short sentence you learned that could help other bots.`);
  const files=(o.files||[]).map(f=>({name:safe(f.path),data:f.content||''}));files.push({name:'NOTES.txt',data:o.summary||''});
  learn('Coder Bot',o.lesson);
  return{bot:'Coder Bot',text:o.summary||'Done.',zip:await zipTo(id,files)};
}
function sprite(seed,scale=16){
  let s=seed;const rnd=()=>(s=(s*1664525+1013904223)>>>0)/4294967296;
  const hue=Math.floor(rnd()*360),cols=[`hsl(${hue},70%,55%)`,`hsl(${(hue+40)%360},70%,40%)`];
  const px=[[20,20,30],[0,0,0],[0,0,0]];
  const hsl=(h,sat,l)=>{const a=sat*Math.min(l,1-l);const f=n=>{const k=(n+h/30)%12;return Math.round(255*(l-a*Math.max(-1,Math.min(k-3,9-k,1))))};return[f(0),f(8),f(4)]};
  px[1]=hsl(hue,.7,.55);px[2]=hsl((hue+40)%360,.7,.4);
  const grid=[];for(let y=0;y<8;y++){grid[y]=[];for(let x=0;x<4;x++){const v=rnd();grid[y][x]=v<.4?0:v<.75?1:2;}}
  const png=new PNG({width:8*scale,height:8*scale});
  for(let y=0;y<8*scale;y++)for(let x=0;x<8*scale;x++){const gx=Math.floor(x/scale),gy=Math.floor(y/scale),c=grid[gy][gx<4?gx:7-gx],i=(png.width*y+x)<<2;
    if(c===0){png.data[i+3]=0;continue}const[r,g,b]=px[c];png.data[i]=r;png.data[i+1]=g;png.data[i+2]=b;png.data[i+3]=255}
  return PNG.sync.write(png);
}
async function spriteBot(msg,input,brain,id){
  const seed=crypto.createHash('md5').update(msg).digest().readUInt32LE(0);
  const files=[1,2,3,4,5,6].map(n=>({name:`sprite_${n}.png`,data:sprite(seed+n*977)}));
  learn('Sprite Bot',`Made 6 mirrored 8x8 pixel sprites for the request "${msg.slice(0,60)}".`);
  return{bot:'Sprite Bot',text:'Made 6 pixel sprites. They are drawn by code, so no AI key is used.',zip:await zipTo(id,files)};
}
const videoBot=async()=>({bot:'Video Bot',text:'I’m not built yet. I need FFmpeg on the server first.'});

app.post('/api/task',upload.single('file'),async(req,res)=>{
  const msg=req.body.message||'',t=req.body.target||'all';
  const brain=readBrain().slice(-30).map(x=>`- ${x.bot}: ${x.lesson}`).join('\n');
  let input='';try{if(req.file)input=readInput(req.file)}catch{}
  const ids=t==='all'?['coder','sprite']:[t],bots={coder,sprite:spriteBot,video:videoBot};
  const results=await Promise.all(ids.map(async k=>{try{return await bots[k](msg,input,brain,crypto.randomUUID())}catch(e){return{bot:k,text:'Something went wrong: '+e.message}}}));
  if(req.file)fs.unlink(req.file.path,()=>{});
  res.json({results});
});
app.listen(process.env.PORT||3000,()=>console.log('Office Bots server running'));
