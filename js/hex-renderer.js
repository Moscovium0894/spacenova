(function(){
  const canvas = document.getElementById('hexCanvas');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const hexR = 80;
  const grid = [
    {cx:W/2-69,cy:H/2-60},{cx:W/2,cy:H/2-60},{cx:W/2+69,cy:H/2-60},
    {cx:W/2-103,cy:H/2},{cx:W/2-34,cy:H/2},{cx:W/2+34,cy:H/2},
    {cx:W/2+103,cy:H/2},{cx:W/2-69,cy:H/2+60},{cx:W/2,cy:H/2+60}
  ];
  function drawHex(cx,cy,r){
    ctx.save();
    ctx.beginPath();
    for(let i=0;i<6;i++) ctx.lineTo(cx+r*Math.cos(i*Math.PI/3),cy+r*Math.sin(i*Math.PI/3));
    ctx.closePath(); ctx.clip();
    const grad = ctx.createRadialGradient(cx,cy,0,cx,cy,r);
    grad.addColorStop(0,'#1a1a3e'); grad.addColorStop(0.5,'#0a0a1a'); grad.addColorStop(1,'#000005');
    ctx.fillStyle = grad; ctx.fill();
    ctx.fillStyle = '#fff';
    for(let i=0;i<20;i++){
      const sx=cx+(Math.random()-0.5)*r*1.5,sy=cy+(Math.random()-0.5)*r*1.5;
      ctx.beginPath(); ctx.arc(sx,sy,Math.random()*1.5,0,Math.PI*2); ctx.fill();
    }
    ctx.fillStyle='rgba(123,104,238,0.15)'; ctx.beginPath(); ctx.arc(cx-20,cy-20,40,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='rgba(0,212,255,0.1)'; ctx.beginPath(); ctx.arc(cx+25,cy+30,35,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='rgba(123,104,238,0.4)'; ctx.lineWidth=2; ctx.stroke();
    ctx.restore();
  }
  function render(){ ctx.fillStyle='#0a0a0f'; ctx.fillRect(0,0,W,H); grid.forEach(h=>drawHex(h.cx,h.cy,hexR)); }
  render();
})();