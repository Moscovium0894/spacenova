(function(){
  var E={name:el('cc-name'),email:el('cc-email'),image:el('cc-image'),count:el('cc-count'),countLabel:el('cc-count-label'),zoom:el('cc-zoom'),fileType:el('cc-filetype'),grid:el('cc-grid'),download:el('cc-download'),emailSend:el('cc-email-send'),status:el('cc-status')};
  var state={img:'',count:6,zoom:1.2};
  function el(id){return document.getElementById(id);} 
  function autoLayout(n){var p=[];var cols=Math.ceil(Math.sqrt(n));for(var i=0;i<n;i++){var r=Math.floor(i/cols),c=i%cols;p.push({r:r,c:c});}return p;}
  function render(){E.countLabel.textContent=String(state.count);E.grid.innerHTML='';var pts=autoLayout(state.count);var minX=999,minY=999,maxX=0,maxY=0;
    pts.forEach(function(p){var x=p.c*104 + (p.r%2?52:0), y=p.r*88;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x+116);maxY=Math.max(maxY,y+132);});
    var w=maxX-minX+20,h=maxY-minY+20;E.grid.style.width=w+'px';E.grid.style.height=h+'px';E.grid.style.margin='20px auto';
    pts.forEach(function(p,idx){var x=p.c*104 + (p.r%2?52:0)-minX+10,y=p.r*88-minY+10;var d=document.createElement('div');d.className='hex';d.style.left=x+'px';d.style.top=y+'px';if(state.img){var img=document.createElement('img');img.src=state.img;img.style.transform='scale('+state.zoom+') translate(0,0)';img.style.left=(-x)+'px';img.style.top=(-y)+'px';img.style.width=w+'px';img.style.height=h+'px';d.appendChild(img);}E.grid.appendChild(d);});
  }
  function payload(){return {version:1,type:'consumer_custom_set',draftOnly:true,name:E.name.value.trim(),customerEmail:E.email.value.trim(),image:state.img,count:state.count,zoom:state.zoom,layout:autoLayout(state.count),createdAt:new Date().toISOString()};}
  function download(){var data=payload();var ext=E.fileType.value==='snova'?'snova':'json';var blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(data.name||'custom-set')+'.'+ext;a.click();setTimeout(function(){URL.revokeObjectURL(a.href);},1500);setStatus('Downloaded '+a.download,'success');}
  function sendEmail(){var data=payload();if(!data.customerEmail){setStatus('Email required','error');return;}fetch('/.netlify/functions/submit-custom-set',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){if(!r.ok)throw new Error('Unable to submit');return r.json();}).then(function(){setStatus('Sent to email queue. Still draft-only.','success');}).catch(function(e){setStatus(e.message,'error');});}
  function setStatus(msg){E.status.textContent=msg;}
  E.count.addEventListener('input',function(){state.count=parseInt(this.value,10)||6;render();});
  E.zoom.addEventListener('input',function(){state.zoom=parseFloat(this.value)||1.2;render();});
  E.image.addEventListener('change',function(){var f=this.files&&this.files[0];if(!f)return;var rd=new FileReader();rd.onload=function(){state.img=rd.result;render();};rd.readAsDataURL(f);});
  E.download.addEventListener('click',download);E.emailSend.addEventListener('click',sendEmail);render();
})();
