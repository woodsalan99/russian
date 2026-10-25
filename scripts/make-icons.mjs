// Draws a simple block-letter "Р" icon as PNGs (no image deps).
import fs from 'node:fs'
import zlib from 'node:zlib'
function crc(buf){let c,t=[];for(let n=0;n<256;n++){c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0}let r=0xffffffff;for(const b of buf)r=t[(r^b)&255]^(r>>>8);return(r^0xffffffff)>>>0}
function chunk(type,data){const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(type),data]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([len,td,c])}
function png(size){
  const px=Buffer.alloc(size*(size*4+1))
  const inRect=(x,y,a,b,c,d)=>x>=a&&x<=c&&y>=b&&y<=d
  for(let y=0;y<size;y++){px[y*(size*4+1)]=0
    for(let x=0;x<size;x++){
      const u=x/size,v=y/size
      let r=79,g=107,b=255 // indigo
      const t=(u+v)/2; r=Math.round(79+(120-79)*t); g=Math.round(107-(40)*t); b=255
      const L=inRect(u,v,.31,.2,.41,.8)||inRect(u,v,.31,.2,.68,.3)||inRect(u,v,.31,.46,.68,.56)||inRect(u,v,.58,.2,.68,.56)
      if(L){r=g=b=255}
      const o=y*(size*4+1)+1+x*4;px[o]=r;px[o+1]=g;px[o+2]=b;px[o+3]=255}}
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size,0);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(px)),chunk('IEND',Buffer.alloc(0))])
}
fs.mkdirSync('public',{recursive:true})
fs.writeFileSync('public/icon-192.png',png(192));fs.writeFileSync('public/icon-512.png',png(512));fs.writeFileSync('public/apple-touch-icon.png',png(180))
fs.writeFileSync('public/icon.svg',`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f6bff"/><stop offset="1" stop-color="#7840ff"/></linearGradient></defs><rect width="100" height="100" rx="22" fill="url(#g)"/><path d="M31 20h10v60H31zM31 20h37v10H31zM31 46h37v10H31zM58 20h10v36H58z" fill="#fff"/></svg>`)
