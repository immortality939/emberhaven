const express=require('express'),crypto=require('crypto'),fs=require('fs'),path=require('path'),{promisify}=require('util');
const scrypt=promisify(crypto.scrypt),app=express();
const SECRET=process.env.AUTH_SECRET||'dev-secret-change-me',SB=(process.env.SUPABASE_URL||'').replace(/\/$/,''),SK=process.env.SUPABASE_SERVICE_KEY||'';
app.set('trust proxy',1);app.use(express.json({limit:'300kb'}));

/* ---- storage: Supabase if env is set, otherwise accounts.json (local testing only) ---- */
const FILE=path.join(__dirname,'accounts.json');let MEM={};try{MEM=JSON.parse(fs.readFileSync(FILE))}catch(e){}
const H={apikey:SK,Authorization:'Bearer '+SK,'Content-Type':'application/json'};
async function getAcc(email){
  if(!SB)return MEM[email]||null;
  const r=await fetch(`${SB}/rest/v1/eh_accounts?email=eq.${encodeURIComponent(email)}&select=*`,{headers:H});
  if(!r.ok)throw new Error('db '+r.status);return (await r.json())[0]||null}
async function putAcc(a,isNew){
  if(!SB){MEM[a.email]=a;fs.writeFileSync(FILE,JSON.stringify(MEM));return}
  const r=isNew?await fetch(`${SB}/rest/v1/eh_accounts`,{method:'POST',headers:{...H,Prefer:'return=minimal'},body:JSON.stringify(a)})
    :await fetch(`${SB}/rest/v1/eh_accounts?email=eq.${encodeURIComponent(a.email)}`,{method:'PATCH',headers:{...H,Prefer:'return=minimal'},body:JSON.stringify(a)});
  if(!r.ok)throw new Error('db '+r.status)}

/* ---- helpers ---- */
const hash=async(s,salt)=>(await scrypt(s,salt,32)).toString('hex'),rnd=n=>crypto.randomBytes(n).toString('hex');
const same=(a,b)=>a.length===b.length&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
const sign=e=>{const p=Buffer.from(e+'|'+(Date.now()+30*864e5)).toString('base64url');return p+'.'+crypto.createHmac('sha256',SECRET).update(p).digest('base64url')};
function verify(t){try{const[p,s]=String(t).split('.'),h=crypto.createHmac('sha256',SECRET).update(p).digest('base64url');if(!same(s,h))return null;const[e,x]=Buffer.from(p,'base64url').toString().split('|');return +x>Date.now()?e:null}catch(e){return null}}
const RL=new Map(),limit=(q,s,n)=>{const k=q.ip,t=Date.now(),r=RL.get(k)||{c:0,t:t+6e5};if(t>r.t){r.c=0;r.t=t+6e5}if(++r.c>30)return s.status(429).json({error:'Too many tries. Wait 10 minutes.'});RL.set(k,r);n()};
setInterval(()=>{const t=Date.now();for(const[k,v]of RL)if(t>v.t)RL.delete(k)},6e5).unref();
const E=b=>String((b&&b.email)||'').trim().toLowerCase(),valid=(e,p)=>e.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)&&typeof p==='string'&&p.length>=6&&p.length<=100;
const wrap=f=>(q,s)=>f(q,s).catch(e=>{console.error(e);s.status(500).json({error:'Server error, try again.'})});
const auth=(q,s,n)=>{const e=verify((q.headers.authorization||'').slice(7));if(!e)return s.status(401).json({error:'Please log in again.'});q.email=e;n()};
const newRec=()=>rnd(5).toUpperCase().replace(/(.{5})(.{5})/,'$1-$2');

/* ---- API ---- */
app.post('/api/register',limit,wrap(async(q,s)=>{
  const e=E(q.body),p=q.body.password;
  if(!valid(e,p))return s.status(400).json({error:'Enter a valid email and a password of 6+ characters.'});
  if(await getAcc(e))return s.status(409).json({error:'That email is already registered. Try logging in.'});
  const salt=rnd(16),rc=newRec();
  await putAcc({email:e,salt,pass:await hash(p,salt),rec:await hash(rc,salt),save:null},true);
  s.json({token:sign(e),recovery:rc,save:null})}));
app.post('/api/login',limit,wrap(async(q,s)=>{
  const e=E(q.body),p=String(q.body.password||''),a=await getAcc(e);
  if(!a||!same(await hash(p,a.salt),a.pass))return s.status(401).json({error:'Wrong email or password.'});
  s.json({token:sign(e),save:a.save})}));
app.post('/api/reset',limit,wrap(async(q,s)=>{
  const e=E(q.body),rc=String(q.body.recovery||'').trim().toUpperCase(),p=q.body.password,a=await getAcc(e);
  if(!valid(e,p))return s.status(400).json({error:'Password must be 6+ characters.'});
  if(!a||!same(await hash(rc,a.salt),a.rec))return s.status(401).json({error:'Wrong email or recovery code.'});
  const salt=rnd(16),nr=newRec();
  Object.assign(a,{salt,pass:await hash(p,salt),rec:await hash(nr,salt)});await putAcc(a,false);
  s.json({token:sign(e),recovery:nr,save:a.save})}));
app.get('/api/save',auth,wrap(async(q,s)=>{const a=await getAcc(q.email);s.json({save:a?a.save:null})}));
app.post('/api/save',auth,wrap(async(q,s)=>{
  let o;try{o=typeof q.body.save==='string'?JSON.parse(q.body.save):q.body.save}catch(e){}
  if(!o||typeof o!=='object'||typeof o.lv!=='number'||o.lv<1||o.lv>999)return s.status(400).json({error:'Bad save.'});
  const a=await getAcc(q.email);if(!a)return s.status(401).json({error:'Please log in again.'});
  a.save=o;await putAcc(a,false);s.json({ok:1})}));

app.get('/',(q,s)=>s.sendFile(path.join(__dirname,'emberhaven-online.html')));
app.listen(process.env.PORT||3000,()=>console.log('Emberhaven server running'));
