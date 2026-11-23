set -e
pnpm design:shots
test -f design/reference/manifest.json
node -e 'const m=require("./design/reference/manifest.json");const w=new Set(m.map(x=>x.width));for(const x of [390,768,1024,1440]) if(!w.has(x)) throw new Error("missing width "+x); const f=new Set(m.map(x=>x.frame)); if(f.size<16) throw new Error("frames "+f.size); console.log(m.length,"images")'
