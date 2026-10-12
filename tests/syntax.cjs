const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');let count=0;
for(const p of fs.readdirSync(root).filter(p=>p.endsWith('.js'))){new vm.Script(fs.readFileSync(path.join(root,p),'utf8'),{filename:p});count++;}
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
 if(!/\bsrc=/.test(m[1])){new vm.Script(m[2],{filename:'index-inline-'+count});count++;}
 else {const src=m[1].match(/src="([^"]+)"/)[1];if(!src.startsWith('http')&&!fs.existsSync(path.join(root,src.split('?')[0])))throw new Error('Missing script '+src);}
}
console.log(count+' JavaScript blocks parsed successfully; local script references exist.');
