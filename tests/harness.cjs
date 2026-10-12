const fs = require('node:fs');
const path = require('node:path');
const {JSDOM, ResourceLoader, VirtualConsole} = require('jsdom');
const root = path.resolve(__dirname, '..');
const copy = x => JSON.parse(JSON.stringify(x));
function fixture() {
  return {meta:{version:'test',updatedAt:'2026-09-01T00:00:00.000Z'},master:{
    M_RAW:[{rawId:1,name:'향료',unit:'g',stdCost:300},{rawId:2,name:'알코올',unit:'g',stdCost:5}],
    M_PACK:[{packId:1,name:'용기',unit:'ea',stdCost:700}],
    M_PRODUCT:[{productId:1,name:'검증용 50ml',code:'TEST-50',fillWeight:40,salePrice:90000,bom:[{type:'RAW',itemId:1,qty:20},{type:'RAW',itemId:2,qty:80},{type:'PACK',itemId:1,qty:1}]}],
    M_CUSTOMER:[{customerId:1,name:'테스트 거래처'}],M_FORMULA:[]},
    stock:{RAW_LOT:[{id:1,rawId:1,lotNo:'R1',qty:1000,remaining:1000,unitCost:300,status:'OK',expDate:'2099-12-31'},{id:2,rawId:2,lotNo:'R2',qty:1000,remaining:1000,unitCost:5,status:'OK',expDate:'2099-12-31'}],PACK_LOT:[{id:3,packId:1,lotNo:'P1',qty:100,remaining:100,unitCost:700,status:'OK'}],BULK_LOT:[],FGT_LOT:[]},txn:{T_GOODS_IN:[],T_BULK:[],T_BATCH:[],T_FILL:[],T_SALE:[],T_QC:[],T_ADJ:[],T_RETURN:[],T_QUICK:[],T_STOCK_MOVE:[],T_QC_PROD:[],T_WORK_ORDER:[],T_PROD_PLAN:[]},logs:[],costHistory:[]};
}
async function app({authenticated=true,data=fixture(),delay=0,fail=false,backend=null,local=null,readFail=false}={}) {
  const server=backend||{data:copy(data),stamp:data.meta.updatedAt,requests:[],fail,delay,readFail};
  const errors=[];
  class Resources extends ResourceLoader {
    fetch(url) {
      const name = new URL(url).pathname.split('/').pop();
      if (url.includes('supabase-js')) return Promise.resolve(Buffer.from(`window.supabase={createClient(){return window.__auth}};`));
      const p=path.join(root,name);
      if(url.startsWith('https://erp.test/')&&fs.existsSync(p)) return Promise.resolve(fs.readFileSync(p));
      return Promise.resolve(Buffer.from(''));
    }
  }
  const vc=new VirtualConsole();
  vc.on('jsdomError',e=>{if(!/Not implemented: (navigation|window.print)/.test(e.message))errors.push(e.message)});
  const dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{url:'https://erp.test/',runScripts:'dangerously',resources:new Resources(),pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){
    w.Headers=Headers;w.AbortController=AbortController;w.Response=Response;w.Request=Request;w.structuredClone=structuredClone;
    w.confirm=()=>true;w.prompt=()=>null;w.alert=()=>{};
    w.HTMLCanvasElement.prototype.getContext=()=>({});
    w.Chart=class{constructor(){this.destroy=()=>{};this.update=()=>{}}};w.Chart.getChart=()=>null;
    w.lucide={createIcons(){}};
    w.URL.createObjectURL=()=> 'blob:test';w.URL.revokeObjectURL=()=>{};
    w.localStorage.setItem('shifti_operator','검증담당자');
    if(local)w.localStorage.setItem('shifti_erp_v2',JSON.stringify(local));
    const session=authenticated?{access_token:'test-jwt',user:{id:'test-user',email:'test@example.invalid'}}:null;
    w.__auth={auth:{getSession:async()=>({data:{session}}),onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}}},signOut:async()=>({}),signInWithPassword:async()=>({data:{session}})}};
    w.fetch=async(url,opts={})=>{
      const method=opts.method||'GET';const u=String(url);server.requests.push({url:u,method,body:opts.body});
      if(server.delay)await new Promise(r=>setTimeout(r,server.delay));
      if(!authenticated)return new Response('{}',{status:401});
      if(server.readFail&&method==='GET')return new Response('{}',{status:503});
      if(server.fail && method!=='GET')return new Response('{}',{status:503});
      if(u.includes('/erp_config'))return new Response('[]');
      if(method==='GET')return new Response(JSON.stringify([{data:copy(server.data),updated_at:server.stamp,updatedAt:server.data.meta.updatedAt}]));
      if(method==='PATCH'){
        const expected=new URL(u).searchParams.get('updated_at');
        if(expected && expected !== 'eq.'+server.stamp)return new Response('[]');
        const b=JSON.parse(opts.body);server.data=b.data;server.stamp=b.updated_at;
        return new Response(JSON.stringify([{updated_at:server.stamp}]));
      }
      if(method==='POST') {const b=JSON.parse(opts.body);server.data=b.data;server.stamp=b.updated_at;return new Response('',{status:201})}
      return new Response('{}');
    };
  }});
  await new Promise(r=>dom.window.addEventListener('load',()=>setTimeout(r,4200),{once:true}));
  const w=dom.window;
  const value=(id,v)=>{const e=w.document.getElementById(id);if(!e)throw new Error('Missing field '+id);e.value=String(v);e.dispatchEvent(new w.Event('change',{bubbles:true}));};
  return {w,server,errors,value,close:()=>w.close()};
}
module.exports={app,fixture,copy};
