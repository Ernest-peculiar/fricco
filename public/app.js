/* Fricco Collection storefront. All data lives on the server; the browser only keeps the cart. */
(function(){
'use strict';
var cfg={currency:'USD',shippingFlat:6,freeShippingOver:100,payment:'simulated'};
var fmt=null,SYM='$',CUR='$';
function setFmt(){
  try{
    fmt=new Intl.NumberFormat('en-US',{style:'currency',currency:cfg.currency});
    var p=fmt.formatToParts(0).filter(function(x){return x.type==='currency'})[0];
    SYM=p?p.value:cfg.currency+' ';CUR=SYM;
  }catch(e){fmt=null}
}
function money(n){return fmt?fmt.format(n):'$'+Number(n).toFixed(2)}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function $(s,r){return (r||document).querySelector(s)}
function fv(f,n){var e=f.elements[n];return e?String(e.value):''}

var cartStore={
  load:function(){try{var v=JSON.parse(localStorage.getItem('fricco.cart')||'[]');return Array.isArray(v)?v.filter(function(c){return c&&Number.isInteger(c.id)&&Number.isInteger(c.qty)&&c.qty>0}):[]}catch(e){return []}},
  save:function(c){try{localStorage.setItem('fricco.cart',JSON.stringify(c))}catch(e){}}
};

function api(method,url,body){
  var opt={method:method,credentials:'same-origin',headers:{}};
  if(body!==undefined){opt.headers['Content-Type']='application/json';opt.body=JSON.stringify(body)}
  return fetch(url,opt).then(function(res){
    return res.json().catch(function(){return {}}).then(function(j){
      if(!res.ok){var e=new Error(j.error||'Something went wrong. Please try again.');e.status=res.status;e.login=!!j.login;throw e}
      return j;
    });
  },function(){throw new Error('Could not reach the server. Check your connection and try again.')});
}

/* ---------- state ---------- */
var products=[],session=null,defaultPw=false,cart=cartStore.load();
var admin={summary:null,orders:[],loaded:false,loading:false,err:''};
var ui={cartOpen:false,modal:null,filter:'All',q:'',tab:'overview',authTab:'login',returnTo:false,confirmDel:null,lastOrder:null,authErr:'',coErr:'',addErr:'',pwMsg:'',busy:false,pending:null,myOrders:null};
var app=$('#app'),overlays=$('#overlays');

function route(){var h=(location.hash||'').replace('#','');return h==='login'||h==='admin'?h:'store'}
function go(h){if((location.hash||'').replace('#','')===h){render()}else{location.hash=h}}
function toast(msg){var b=$('#toastbox');b.innerHTML='<div class="toast" role="status">'+esc(msg)+'</div>';clearTimeout(toast.t);toast.t=setTimeout(function(){b.innerHTML=''},2600)}
function isAdmin(){return !!(session&&session.role==='admin')}
function cats(){var c=[];products.forEach(function(p){if(c.indexOf(p.cat)<0)c.push(p.cat)});return c}
function pById(id){for(var i=0;i<products.length;i++)if(String(products[i].id)===String(id))return products[i];return null}
function cartLines(){var out=[];cart.forEach(function(c){var p=pById(c.id);if(p)out.push({p:p,qty:c.qty})});return out}
function cartCount(){return cartLines().reduce(function(a,l){return a+l.qty},0)}
function totals(){
  var sub=Math.round(cartLines().reduce(function(a,l){return a+l.p.price*l.qty},0)*100)/100;
  var ship=sub>0&&sub<cfg.freeShippingOver?cfg.shippingFlat:0;
  return{sub:sub,ship:ship,total:Math.round((sub+ship)*100)/100};
}
function saveCart(){cartStore.save(cart)}
function syncCart(){
  cart=cart.filter(function(c){var p=pById(c.id);return p&&p.stock>0}).map(function(c){var p=pById(c.id);return{id:c.id,qty:Math.min(c.qty,p.stock)}});
  saveCart();
}
function loadProducts(){return api('GET','/api/products').then(function(r){products=r;syncCart()})}

/* ---------- product illustrations (inline SVG so the demo needs no image files) ---------- */
var uid=0;
function jersey(c1,c2,num){
  var id='cp'+(++uid);
  var d='M60 26 L82 18 Q100 34 118 18 L140 26 L182 62 L162 94 L142 82 L142 178 Q100 187 58 178 L58 82 L38 94 L18 62 Z';
  return '<svg viewBox="0 0 200 200" role="img" aria-label="Jersey"><defs><clipPath id="'+id+'"><path d="'+d+'"/></clipPath></defs>'+
  '<g clip-path="url(#'+id+')"><rect width="200" height="200" fill="'+c1+'"/>'+
  '<rect x="76" width="12" height="200" fill="'+c2+'" opacity=".16"/><rect x="100" width="12" height="200" fill="'+c2+'" opacity=".16"/><rect x="124" width="12" height="200" fill="'+c2+'" opacity=".16"/>'+
  '<rect x="100" width="100" height="200" fill="#000" opacity=".08"/></g>'+
  '<path d="M18 62 L38 94" stroke="'+c2+'" stroke-width="8"/><path d="M182 62 L162 94" stroke="'+c2+'" stroke-width="8"/>'+
  '<path d="M82 18 Q100 34 118 18" fill="none" stroke="'+c2+'" stroke-width="6"/>'+
  '<circle cx="76" cy="62" r="6" fill="'+c2+'"/>'+
  '<text x="100" y="134" text-anchor="middle" font-family="Archivo,Arial,sans-serif" font-weight="900" font-size="46" fill="'+c2+'">'+esc(num||'10')+'</text>'+
  '<path d="'+d+'" fill="none" stroke="rgba(0,0,0,.28)"/></svg>';
}
function cue(c1,c2){
  return '<svg viewBox="0 0 200 200" role="img" aria-label="Pool cue"><g transform="rotate(-38 100 100)">'+
  '<rect x="-24" y="97" width="8" height="6" rx="2" fill="#5aa0c8"/><rect x="-16" y="96.5" width="12" height="7" fill="#f4f1e8"/>'+
  '<polygon points="-4,97.5 132,96 132,104 -4,102.5" fill="#dcbc7c"/>'+
  '<polygon points="132,96 222,94 222,106 132,104" fill="'+c1+'"/><polygon points="150,95.6 182,95 182,105 150,104.4" fill="'+c2+'"/>'+
  '<rect x="216" y="94" width="8" height="12" rx="2" fill="#1b1b1b"/></g>'+
  '<circle cx="150" cy="158" r="14" fill="#f2c230"/><circle cx="150" cy="158" r="6" fill="#fff"/>'+
  '<circle cx="176" cy="140" r="14" fill="#d33b2f"/><circle cx="176" cy="140" r="6" fill="#fff"/>'+
  '<circle cx="176" cy="172" r="14" fill="#161616"/><circle cx="176" cy="172" r="6" fill="#fff"/></svg>';
}
function balls(){
  var cols=['#f2c230','#2a59b8','#d33b2f','#5a2a82','#e8812c','#1f7a45','#7b1f1f','#161616','#f2c230','#2a59b8'];
  var out='<svg viewBox="0 0 200 200" role="img" aria-label="Billiard balls">';var n=0;
  for(var r=0;r<4;r++){for(var i=0;i<=r;i++){
    var x=100+(i-r/2)*40,y=48+r*35;
    out+='<circle cx="'+x+'" cy="'+y+'" r="18" fill="'+cols[n]+'"/><ellipse cx="'+(x-6)+'" cy="'+(y-8)+'" rx="5" ry="3" fill="#fff" opacity=".35"/>'+
    '<circle cx="'+x+'" cy="'+y+'" r="8" fill="#fff"/><text x="'+x+'" y="'+(y+3.5)+'" text-anchor="middle" font-family="Archivo,Arial" font-weight="800" font-size="10" fill="#111">'+(n+1)+'</text>';
    n++;}}
  return out+'</svg>';
}
function tile(x,y,ch,s,z){
  z=z||26;
  return '<rect x="'+x+'" y="'+y+'" width="'+z+'" height="'+z+'" rx="3" fill="#EFD9A0" stroke="#c4a766"/>'+
  '<text x="'+(x+z/2-1)+'" y="'+(y+z*0.7)+'" text-anchor="middle" font-family="Archivo,Arial" font-weight="800" font-size="'+(z*0.6)+'" fill="#3a2a10">'+ch+'</text>'+
  '<text x="'+(x+z-3)+'" y="'+(y+z-3)+'" text-anchor="end" font-family="Archivo,Arial" font-weight="700" font-size="'+(z*0.26)+'" fill="#3a2a10">'+s+'</text>';
}
function scrabble(c1){
  var o='<svg viewBox="0 0 200 200" role="img" aria-label="Scrabble"><rect x="10" y="14" width="180" height="124" rx="6" fill="'+(c1||'#2f6b4f')+'"/>';
  var row=function(w,x,y,sc){for(var i=0;i<w.length;i++)o+=tile(x+i*29,y,w[i],sc[i])};
  row('PLAY',46,22,[3,1,1,4]);row('FRICCO',14,51,[4,1,1,3,3,1]);row('WIN',75,80,[4,1,1]);row('GO',46,109,[2,1]);
  o+='<rect x="34" y="150" width="132" height="34" rx="5" fill="#8a5a2b"/>';
  var r='SCORES';for(var j=0;j<6;j++)o+=tile(40+j*20.5,156,r[j],1,19);
  return o+'</svg>';
}
function darts(c1,c2){
  var o='<svg viewBox="0 0 200 200" role="img" aria-label="Dart board"><circle cx="100" cy="100" r="88" fill="#1b1b1b"/>';
  var rs=[80,64,50,36,22,10],cs=[c1,'#efe7c9',c2,'#efe7c9',c1,c2];
  for(var i=0;i<rs.length;i++)o+='<circle cx="100" cy="100" r="'+rs[i]+'" fill="'+cs[i]+'"/>';
  for(var a=0;a<20;a++){var t=a*Math.PI/10;o+='<line x1="100" y1="100" x2="'+(100+80*Math.cos(t)).toFixed(1)+'" y2="'+(100+80*Math.sin(t)).toFixed(1)+'" stroke="#9a9a90" stroke-width=".8"/>'}
  o+='<circle cx="100" cy="100" r="10" fill="'+c2+'"/><circle cx="100" cy="100" r="4" fill="'+c1+'"/>';
  o+='<g stroke="#222" stroke-width="3"><line x1="150" y1="40" x2="122" y2="82"/><line x1="46" y1="52" x2="84" y2="92"/></g><g fill="'+c2+'"><circle cx="152" cy="38" r="6"/><circle cx="44" cy="50" r="6"/></g>';
  return o+'</svg>';
}
function paddle(c1,c2){
  return '<svg viewBox="0 0 200 200" role="img" aria-label="Table tennis paddles">'+
  '<g transform="rotate(-24 70 110)"><rect x="63" y="108" width="14" height="60" rx="6" fill="#d9b779"/><ellipse cx="70" cy="78" rx="42" ry="46" fill="'+c1+'"/><ellipse cx="70" cy="78" rx="36" ry="40" fill="none" stroke="rgba(255,255,255,.35)"/></g>'+
  '<g transform="rotate(24 132 110)"><rect x="125" y="108" width="14" height="60" rx="6" fill="#d9b779"/><ellipse cx="132" cy="78" rx="42" ry="46" fill="'+c2+'"/><ellipse cx="132" cy="78" rx="36" ry="40" fill="none" stroke="rgba(255,255,255,.35)"/></g>'+
  '<circle cx="101" cy="168" r="9" fill="#fff" stroke="#bbb"/></svg>';
}
function art(p){
  switch(p.art){
    case 'cue':return cue(p.c1,p.c2);
    case 'balls':return balls();
    case 'scrabble':return scrabble(p.c1);
    case 'darts':return darts(p.c1,p.c2);
    case 'paddle':return paddle(p.c1,p.c2);
    default:return jersey(p.c1,p.c2,p.num);
  }
}
function pic(p){return p.img?'<img src="'+esc(p.img)+'" alt="'+esc(p.name)+'">':art(p)}

/* ---------- store view ---------- */
function stockLabel(p){return p.stock<=0?'<span class="stock low">Sold out</span>':p.stock<=5?'<span class="stock low">Only '+p.stock+' left</span>':'<span class="stock">In stock</span>'}
function card(p){
  return '<article class="prod"><div class="pic"><span class="tag mono">'+esc(p.cat)+'</span>'+pic(p)+'</div>'+
  '<div class="row"><h3>'+esc(p.name)+'</h3><span class="price">'+money(p.price)+'</span></div>'+
  '<p>'+esc(p.desc||'')+'</p>'+
  '<div class="foot">'+stockLabel(p)+'<button class="btn y" data-action="add" data-id="'+esc(p.id)+'"'+(p.stock<=0?' disabled':'')+'>Add to cart<span class="arr">+</span></button></div></article>';
}
function filtered(){
  var q=ui.q.trim().toLowerCase();
  return products.filter(function(p){return (ui.filter==='All'||p.cat===ui.filter)&&(!q||(p.name+' '+p.cat+' '+(p.desc||'')).toLowerCase().indexOf(q)>=0)});
}
function gridHtml(){var l=filtered();return l.length?l.map(card).join(''):'<div class="empty">Nothing matches that search. Try another word or category.</div>'}
function chipsHtml(){return ['All'].concat(cats()).map(function(c){return '<button class="chip" data-action="filter" data-cat="'+esc(c)+'" aria-pressed="'+(ui.filter===c)+'">'+esc(c)+'</button>'}).join('')}
function navRight(){
  var cartBtn='<button class="pillbtn solid" data-action="openCart">Cart ('+cartCount()+')</button>';
  if(!session)return '<button class="pillbtn" data-action="toLogin">Log in</button>'+cartBtn;
  return '<span class="hi">Hi, '+esc(session.name.split(' ')[0])+'</span>'+(!isAdmin()?'<button class="pillbtn" data-action="myOrders">My orders</button>':'')+(isAdmin()?'<button class="pillbtn" data-action="toAdmin">Dashboard</button>':'')+'<button class="pillbtn" data-action="logout">Log out</button>'+cartBtn;
}
function viewStore(){
  var tk=['New 2026 home kit is in','Free delivery on orders over '+money(cfg.freeShippingOver),'Custom name and number on every jersey','Pool, Scrabble, darts and table tennis'];
  var tkh=tk.map(function(t){return '<span>'+esc(t)+'</span>'}).join('');
  return '<div class="ticker" aria-hidden="true"><div class="track">'+tkh+tkh+tkh+tkh+'</div></div>'+
  '<div class="wrap"><nav class="nav"><div class="links"><button data-action="scroll" data-to="shop">Shop</button><button data-action="catlink" data-cat="Jerseys">Jerseys</button><button data-action="catlink" data-cat="Pool">Games</button><button data-action="scroll" data-to="about">About</button></div><div class="right">'+navRight()+'</div></nav>'+
  '<svg class="wordmark" viewBox="0 0 1000 220" role="img" aria-label="Fricco"><text x="0" y="200" font-size="260" textLength="1000" lengthAdjust="spacingAndGlyphs">FRICCO</text><rect class="band" x="-6" y="40" width="1012" height="92" rx="46"/></svg>'+
  '<div class="meta"><span>Fricco Collection &nbsp;/&nbsp; Est. 2026</span><span>Wear it. Play it. Own it.</span></div>'+
  '<section class="hero"><div class="stage"><span class="hint mono muted">Hover to tilt · tap to spin</span><div class="big"><div class="gshadow"></div><button class="spin" data-action="spin" aria-label="Spin the jersey">'+jersey('#24352C','#F2EB3C','10')+'</button></div>'+
  '<div class="orb ball8" style="left:6%;top:14%;--d:36" aria-hidden="true"><span>8</span></div>'+
  '<div class="orb ballY" style="left:11%;bottom:7%;--d:30" aria-hidden="true"><span>1</span></div>'+
  '<div class="orb tileo" style="right:3%;top:3%;--d:32" aria-hidden="true">F</div>'+
  '<div class="fpill" style="left:clamp(8px,24%,300px);top:9%">Breathable dri-fit knit<i></i></div>'+
  '<div class="fpill b" style="left:2%;top:56%">Custom name &amp; number<i></i></div>'+
  '<div class="lens" aria-hidden="true"><svg viewBox="0 0 200 200"><defs><pattern id="wv" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#24352C"/><rect width="4" height="8" fill="#2d4338"/></pattern></defs><rect width="200" height="200" fill="url(#wv)"/><circle cx="100" cy="92" r="40" fill="none" stroke="#F2EB3C" stroke-width="5"/><text x="100" y="108" text-anchor="middle" font-family="Archivo,Arial" font-weight="900" font-size="46" fill="#F2EB3C">FC</text><text x="100" y="170" text-anchor="middle" font-family="Space Mono,monospace" font-size="11" letter-spacing="3" fill="#F2EB3C">EST. 2026</text></svg></div></div>'+
  '<div class="herofoot"><p>At Fricco Collection we outfit the people who play. Match-day jerseys cut for movement, plus the pool cues, Scrabble sets and table games that fill the evenings between fixtures.</p><button class="btn" data-action="scroll" data-to="shop">Explore more<span class="arr">&rarr;</span></button></div></section>'+
  '<section class="sec" id="shop"><span class="mono muted">Shop the collection</span><h2><span>Kits and games:</span> where every match tells a story</h2></section>'+
  '<div class="toolbar"><div class="chips" id="chips">'+chipsHtml()+'</div><input class="search" id="q" type="search" placeholder="Search jerseys, cues, games" value="'+esc(ui.q)+'" aria-label="Search products"></div>'+
  '<div class="grid" id="grid">'+gridHtml()+'</div>'+
  '<section class="about" id="about"><span class="mono muted">About Fricco</span><p>Fricco Collection started with one kit and a borrowed pool table. Today we sell jerseys that survive a full season and games that survive a full evening. Everything in the shop is picked by people who play. Browse as a guest, then log in when you are ready to pay.</p></section>'+
  '<footer class="foot2"><span>&copy; 2026 Fricco Collection</span><span>'+(cfg.payment==='simulated'?'Demo store: payments are simulated and no card is charged.':cfg.payment==='none'?'Orders are confirmed by our team.':'Secure checkout')+'</span></footer></div>';
}

/* ---------- login view ---------- */
function viewLogin(){
  var su=ui.authTab==='signup';
  return '<div class="wrap"><div style="padding-top:20px"><button class="back" data-action="toStore">&larr; Back to shop</button></div>'+
  '<div class="auth"><div class="l"><div><svg viewBox="0 0 1000 220" class="wordmark" aria-hidden="true"><text x="0" y="200" font-size="260" textLength="1000" lengthAdjust="spacingAndGlyphs">FRICCO</text><rect class="band" x="-6" y="40" width="1012" height="92" rx="46"/></svg>'+
  '<p>'+(ui.returnTo?'Log in to pay for your cart. Your items are saved.':'Log in to check out, track your orders and get early access to new kits.')+'</p></div>'+
  '<div class="poolwrap"><canvas id="pool" class="pool" role="img" aria-label="Pool table you can play. Drag back from the cue ball and release to shoot."></canvas>'+
  '<div class="poolbar"><span id="poolstat" class="mono"></span><span id="poolcount" class="mono muted"></span><button class="pillbtn" type="button" data-action="rerack">Re-rack</button></div></div></div>'+
  '<div class="r"><h1>'+(su?'Create account':'Log in')+'</h1>'+
  '<div class="tabs"><button class="chip" data-action="authtab" data-t="login" aria-pressed="'+!su+'">Log in</button><button class="chip" data-action="authtab" data-t="signup" aria-pressed="'+su+'">Create account</button></div>'+
  '<form data-form="'+(su?'signup':'login')+'" novalidate>'+
  (su?'<div class="field"><label for="a-name">Full name</label><input id="a-name" name="name" autocomplete="name"></div>':'')+
  '<div class="field"><label for="a-email">Email</label><input id="a-email" name="email" type="email" autocomplete="email"></div>'+
  '<div class="field"><label for="a-pw">Password'+(su?' (8 characters or more)':'')+'</label><input id="a-pw" name="pw" type="password" autocomplete="'+(su?'new-password':'current-password')+'"></div>'+
  '<p class="err" role="alert">'+esc(ui.authErr)+'</p>'+
  '<button class="btn y" type="submit" style="margin-top:6px">'+(su?'Create account':'Log in')+'<span class="arr">&rarr;</span></button></form>'+
  '</div></div></div>';
}

/* ---------- overlays ---------- */
function viewOverlays(){
  var o='';
  if(ui.cartOpen){
    var L=cartLines(),t=totals();
    o+='<div class="scrim" data-action="closeCart"></div><aside class="drawer" aria-label="Your cart"><header><h2>Your cart</h2><button class="xbtn" data-action="closeCart" aria-label="Close cart">&times;</button></header><div class="items">';
    if(!L.length)o+='<p class="muted" style="padding:24px 0">Your cart is empty. Add a jersey or a game to get started.</p>';
    L.forEach(function(l){
      o+='<div class="line"><div class="th">'+pic(l.p)+'</div><div><b>'+esc(l.p.name)+'</b><span class="muted" style="font-size:12px">'+money(l.p.price)+' each</span><div class="qty"><button data-action="dec" data-id="'+esc(l.p.id)+'" aria-label="Decrease quantity">&minus;</button><span>'+l.qty+'</span><button data-action="inc" data-id="'+esc(l.p.id)+'" aria-label="Increase quantity">+</button></div></div><div style="text-align:right"><b>'+money(l.p.price*l.qty)+'</b><br><button class="back" data-action="rm" data-id="'+esc(l.p.id)+'">Remove</button></div></div>';
    });
    o+='</div>';
    if(L.length){
      o+='<div class="sum"><div><span>Subtotal</span><span>'+money(t.sub)+'</span></div><div><span>Delivery</span><span>'+(t.ship?money(t.ship):'Free')+'</span></div><div class="tot"><span>Total</span><span>'+money(t.total)+'</span></div></div>';
      if(session){o+='<div style="margin-top:14px"><button class="btn y" data-action="checkout" style="width:100%;justify-content:space-between">Checkout<span class="arr">&rarr;</span></button></div>'}
      else{o+='<div class="gate"><b>Log in to pay</b><p>You can keep browsing. To pay for these items, log in or create a free account. Your cart will be waiting.</p><div class="row2"><button class="pillbtn solid" data-action="gateLogin">Log in</button><button class="pillbtn" data-action="gateSignup">Create account</button></div></div>'}
    }
    o+='</aside>';
  }
  if(ui.modal==='checkout'&&session){
    var T=totals(),sim=cfg.payment==='simulated',pend=ui.pending;
    o+='<div class="scrim" data-action="closeModal"></div><div class="modal" role="dialog" aria-label="Checkout"><h2>Checkout</h2>'+
    '<p class="note" style="margin:0 0 4px">'+(sim?'Test mode: use card 4242 4242 4242 4242, any future date and any 3 digit CVC. No money moves.':cfg.payment==='none'?'No payment is taken on the site. We will contact you to arrange payment and delivery.':'You will be sent to our payment partner to pay securely.')+'</p>'+
    '<form data-form="checkout" novalidate>';
    if(!pend){
      o+='<div class="field"><label for="co-name">Name for delivery</label><input id="co-name" name="name" autocomplete="name" value="'+esc(session.name)+'"></div>'+
      '<div class="field"><label for="co-phone">Phone (optional)</label><input id="co-phone" name="phone" type="tel" autocomplete="tel"></div>'+
      '<div class="field"><label for="co-addr">Delivery address</label><textarea id="co-addr" name="addr" rows="2" autocomplete="street-address"></textarea></div>';
    }else{
      o+='<p class="note">Order '+esc(pend.id)+' is saved. Enter your card details to finish paying.</p>';
    }
    if(sim){
      o+='<div class="field"><label for="co-card">Card number</label><input id="co-card" name="card" inputmode="numeric" autocomplete="cc-number" placeholder="4242 4242 4242 4242"></div>'+
      '<div class="two"><div class="field"><label for="co-exp">Expiry</label><input id="co-exp" name="exp" autocomplete="cc-exp" placeholder="MM/YY"></div><div class="field"><label for="co-cvc">CVC</label><input id="co-cvc" name="cvc" inputmode="numeric" autocomplete="cc-csc" placeholder="123"></div></div>';
    }
    o+='<div class="sum" style="margin-top:14px"><div><span>Subtotal</span><span>'+money(T.sub)+'</span></div><div><span>Delivery</span><span>'+(T.ship?money(T.ship):'Free')+'</span></div><div class="tot"><span>Total</span><span>'+money(T.total)+'</span></div></div>'+
    '<p class="err" role="alert"></p>'+
    '<div class="row2" style="margin-top:8px"><button class="btn y" type="submit">'+(sim?'Pay '+money(T.total):cfg.payment==='none'?'Place order':'Continue to payment')+'<span class="arr">&rarr;</span></button><button class="pillbtn" type="button" data-action="closeModal">Cancel</button></div></form></div>';
  }
  if(ui.modal==='success'&&ui.lastOrder){
    var od=ui.lastOrder;
    o+='<div class="scrim" data-action="closeModal"></div><div class="modal" role="dialog" aria-label="Order placed"><h2>Order placed</h2><p style="margin:6px 0 14px;color:var(--ink2)">Thank you'+(od.customer?', '+esc(String(od.customer).split(' ')[0]):'')+'. Your order <b>'+esc(od.id)+'</b>'+(od.total!=null?' for '+money(od.total):'')+(cfg.payment==='none'?' is placed. We will contact you to arrange payment and delivery.':' is confirmed.')+' You can follow it under My orders.</p><button class="btn y" data-action="closeModal">Keep shopping<span class="arr">&rarr;</span></button></div>';
  }
  if(ui.modal==='orders'&&session){
    o+='<div class="scrim" data-action="closeModal"></div><div class="modal" role="dialog" aria-label="Your orders"><h2>Your orders</h2>';
    if(ui.myOrders===null)o+='<p class="note">Loading your orders…</p>';
    else if(!ui.myOrders.length)o+='<p class="note">You have not placed an order yet.</p>';
    else ui.myOrders.forEach(function(r){
      o+='<div class="orderrow"><div class="row2" style="justify-content:space-between"><b>'+esc(r.id)+'</b><span class="st '+esc(r.status.split(' ')[0])+'">'+esc(r.status)+'</span></div>'+
      '<div class="muted" style="font-size:12px">'+new Date(r.date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})+' · '+money(r.total)+'</div>'+
      '<div style="font-size:13px;margin-top:4px">'+r.items.map(function(i){return esc(i.name)+' ×'+i.qty}).join(', ')+'</div></div>';
    });
    o+='<div style="margin-top:14px"><button class="pillbtn" data-action="closeModal">Close</button></div></div>';
  }
  return o;
}

function niceMax(v){var p=Math.pow(10,Math.floor(Math.log(v)/Math.LN10)),n=v/p;return (n<=1?1:n<=2?2:n<=2.5?2.5:n<=5?5:10)*p}
function fmtTick(v){return CUR+(v>=1000?(+(v/1000).toFixed(2))+'k':(+v.toFixed(2)))}
function dayStart(ts){var d=new Date(ts);d.setHours(0,0,0,0);return d.getTime()}
function chart(days){
  var W=720,H=280,L=56,R=10,T=14,B=36,iw=W-L-R,ih=H-T-B,bw=iw/days.length;
  var max=niceMax(Math.max.apply(null,days.map(function(d){return d.v}).concat([1])));
  var s='<svg class="chart" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Revenue per day for the last 14 days">';
  for(var i=0;i<=4;i++){var y=T+ih-ih*i/4;s+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+y+'" y2="'+y+'" stroke="var(--line)" stroke-width="1"/><text x="'+(L-8)+'" y="'+(y+4)+'" text-anchor="end" font-size="11" fill="var(--muted)" font-family="Space Mono,monospace">'+fmtTick(max*i/4)+'</text>'}
  days.forEach(function(d,i){
    var h=ih*d.v/max,x=L+i*bw+bw*.18,w=bw*.64,last=i===days.length-1;
    s+='<rect x="'+x.toFixed(1)+'" y="'+(T+ih-h).toFixed(1)+'" width="'+w.toFixed(1)+'" height="'+h.toFixed(1)+'" rx="3" fill="'+(last?'var(--yellow)':'var(--ink2)')+'"'+(last?' stroke="var(--ink)" stroke-width="1.5"':'')+'><title>'+d.label+': '+money(d.v)+'</title></rect>';
    if(i%2===1||last&&false)s+='<text x="'+(x+w/2).toFixed(1)+'" y="'+(H-12)+'" text-anchor="middle" font-size="11" fill="var(--muted)" font-family="Space Mono,monospace">'+d.label+'</text>';
  });
  return s+'</svg>';
}
function loadAdmin(){
  if(admin.loading)return;
  admin.loading=true;admin.err='';
  var tz=new Date().getTimezoneOffset();
  Promise.all([api('GET','/api/admin/summary?tz='+tz),api('GET','/api/admin/orders')]).then(function(r){
    admin.summary=r[0];admin.orders=r[1];admin.loaded=true;admin.loading=false;
    if(route()==='admin')render();
  }).catch(function(e){
    admin.loading=false;
    if(e.status===401||e.status===403){session=null;go('login');return}
    admin.err=e.message;if(route()==='admin')render();
  });
}
function refreshAdmin(){admin.loading=false;loadAdmin()}

function adminOverview(){
  var S=admin.summary;
  var days=S.days.map(function(d){return{v:d.total,label:new Date(d.date+'T00:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'})}});
  var last7=0,prev7=0;days.forEach(function(d,i){if(i>=7)last7+=d.v;else prev7+=d.v});
  var dl=prev7>0?((last7-prev7)/prev7*100):null;
  var catRows=S.byCategory,catMax=catRows.length?catRows[0].total:1;
  var o='<div class="kpis">'+
   '<div class="kpi"><span class="mono muted">Revenue</span><div class="v">'+money(S.revenue)+'</div>'+(dl===null?'':'<span class="delta '+(dl>=0?'up':'down')+'">'+(dl>=0?'+':'')+dl.toFixed(1)+'% vs previous 7 days</span>')+'</div>'+
   '<div class="kpi"><span class="mono muted">Orders</span><div class="v">'+S.orders+'</div>'+(S.pending?'<span class="delta">'+S.pending+' waiting for payment</span>':'')+'</div>'+
   '<div class="kpi"><span class="mono muted">Units sold</span><div class="v">'+S.units+'</div></div>'+
   '<div class="kpi"><span class="mono muted">Average order</span><div class="v">'+money(S.orders?S.revenue/S.orders:0)+'</div></div></div>';
  if(S.sampleOrders>0)o+='<p class="sub">This dashboard includes sample orders. <button class="back" style="text-decoration:underline" data-action="clearSample">Remove sample orders</button></p>';
  o+='<div class="cols"><div class="panelc"><h3>Revenue, last 14 days</h3>'+chart(days)+'</div>'+
   '<div class="stack"><div class="panelc"><h3>Sales by category</h3><div class="bars">'+(catRows.length?catRows.map(function(r){return '<div class="b"><div><span>'+esc(r.cat)+'</span><b>'+money(r.total)+'</b></div><div class="track"><div class="fill" style="width:'+(r.total/catMax*100).toFixed(1)+'%"></div></div></div>'}).join(''):'<span class="muted">No sales yet.</span>')+'</div></div>'+
   '<div class="panelc"><h3>Low stock</h3>'+(S.low.length?'<div class="lowlist">'+S.low.map(function(p){return '<span class="st">'+esc(p.name)+' · '+p.stock+' left</span>'}).join('')+'</div>':'<span class="muted">Every product has healthy stock.</span>')+'</div></div></div>'+
   '<div class="cols"><div class="panelc"><h3>Recent orders</h3>'+ordersTable(admin.orders.slice(0,6),false)+'</div>'+
   '<div class="panelc"><h3>Top sellers</h3><div class="tablewrap"><table><thead><tr><th>Product</th><th class="n">Units</th><th class="n">Revenue</th></tr></thead><tbody>'+
   (S.top.length?S.top.map(function(t){return '<tr><td>'+esc(t.name)+'</td><td class="n">'+t.units+'</td><td class="n">'+money(t.total)+'</td></tr>'}).join(''):'<tr><td colspan="3" class="muted">No sales yet.</td></tr>')+'</tbody></table></div></div></div>';
  return o;
}

function adminSecurity(){
  return '<div class="panelc" style="margin-block:14px;max-width:460px"><h3>Change admin password</h3>'+
  (defaultPw?'<p class="sub">You are still using the starting password. Choose a new one before you share this site.</p>':'')+
  '<form data-form="password" novalidate><div class="field"><label for="pw-cur">Current password</label><input id="pw-cur" name="current" type="password" autocomplete="current-password"></div>'+
  '<div class="field"><label for="pw-new">New password (8 characters or more)</label><input id="pw-new" name="next" type="password" autocomplete="new-password"></div>'+
  '<p class="err" role="alert"></p>'+(ui.pwMsg?'<p class="note" style="color:var(--good)">'+esc(ui.pwMsg)+'</p>':'')+
  '<button class="btn y" type="submit" style="margin-top:8px">Save password<span class="arr">&rarr;</span></button></form></div>';
}

function viewAdmin(){
  var tabs=[['overview','Overview'],['products','Products'],['orders','Orders'],['security','Security']];
  var body;
  if(ui.tab==='security')body=adminSecurity();
  else if(!admin.loaded)body='<div class="panelc" style="margin-top:14px">'+(admin.err?'<p class="err">'+esc(admin.err)+'</p><button class="pillbtn" data-action="retryAdmin">Try again</button>':'<p class="muted">Loading the dashboard…</p>')+'</div>';
  else body=ui.tab==='products'?adminProducts():ui.tab==='orders'?'<div class="panelc" style="margin-top:14px"><h3>All orders ('+admin.orders.length+')</h3>'+ordersTable(admin.orders,true)+'</div>':adminOverview();
  return '<div class="abar"><div class="wrap"><b>FRICCO<i>ADMIN</i></b><div class="row2"><button class="pillbtn" data-action="toStore">View store</button><button class="pillbtn" data-action="logout">Log out</button></div></div></div>'+
  '<div class="wrap">'+(defaultPw&&ui.tab!=='security'?'<div class="banner">You are still using the starting admin password. <button class="back" style="text-decoration:underline" data-action="tab" data-t="security">Change it now</button></div>':'')+
  '<div class="atabs">'+tabs.map(function(t){return '<button class="chip" data-action="tab" data-t="'+t[0]+'" aria-pressed="'+(ui.tab===t[0])+'">'+t[1]+'</button>'}).join('')+'</div>'+body+'<div style="height:48px"></div></div>';
}

/* ---------- render ---------- */
function render(){
  var r=route();
  ui.busy=false; /* every form is rebuilt below, so none can still be waiting */
  if(r==='admin'&&!isAdmin()){if(session){go('')}else{ui.authTab='login';go('login')}return}
  if(r==='login'&&session){go(isAdmin()?'admin':'');return}
  app.innerHTML=r==='admin'?viewAdmin():r==='login'?viewLogin():viewStore();
  overlays.innerHTML=r==='admin'?'':viewOverlays();
  if(r==='login')bindPool();
  if(r==='admin'&&!admin.loaded&&!admin.loading)loadAdmin();
}

function dt(ts){return new Date(ts).toLocaleDateString('en-US',{month:'short',day:'numeric'})}
function statusList(cur){var l=['Placed','Paid','Shipped','Delivered','Cancelled'];if(cfg.payment!=='none')l.unshift('Pending payment');if(l.indexOf(cur)<0)l.unshift(cur);return l}
function ordersTable(list,editable){
  if(!list.length)return '<p class="muted">No orders yet.</p>';
  var h='<div class="tablewrap"><table><thead><tr><th>Order</th><th>Date</th><th>Customer</th>'+(editable?'<th>Items</th><th>Ship to</th>':'')+'<th class="n">Total</th><th>Status</th></tr></thead><tbody>';
  list.forEach(function(o){
    var st=editable?'<select class="sel" data-status="'+esc(o.id)+'" aria-label="Status for '+esc(o.id)+'">'+statusList(o.status).map(function(s){return '<option'+(o.status===s?' selected':'')+'>'+s+'</option>'}).join('')+'</select>':'<span class="st '+o.status.split(' ')[0]+'">'+o.status+'</span>';
    h+='<tr><td><b>'+esc(o.id)+'</b></td><td>'+dt(o.date)+'</td><td>'+esc(o.customer)+'</td>'+(editable?'<td>'+o.items.map(function(i){return esc(i.name)+' ×'+i.qty}).join(', ')+'</td><td>'+esc(o.address||'')+(o.phone?'<br><span class="muted">'+esc(o.phone)+'</span>':'')+'</td>':'')+'<td class="n">'+money(o.total)+'</td><td>'+st+'</td></tr>';
  });
  return h+'</tbody></table></div>';
}
function adminProducts(){
  var sold={};admin.orders.forEach(function(o){if(o.status==='Placed'||o.status==='Paid'||o.status==='Shipped'||o.status==='Delivered')o.items.forEach(function(i){sold[i.id]=(sold[i.id]||0)+i.qty})});
  var o='<div class="panelc" style="margin-block:14px"><h3>Add a product</h3><form data-form="addproduct" class="pform" novalidate>'+
  '<div class="field wide"><label for="n-name">Product name</label><input id="n-name" name="name"></div>'+
  '<div class="field"><label for="n-cat">Category</label><input id="n-cat" name="cat" list="catlist" placeholder="Jerseys"><datalist id="catlist">'+cats().map(function(c){return '<option value="'+esc(c)+'">'}).join('')+'</datalist></div>'+
  '<div class="field"><label for="n-price">Price ('+SYM+')</label><input id="n-price" name="price" type="number" min="0" step="0.01"></div>'+
  '<div class="field"><label for="n-stock">Stock</label><input id="n-stock" name="stock" type="number" min="0" step="1" value="10"></div>'+
  '<div class="field"><label for="n-art">Illustration</label><select id="n-art" name="art"><option value="jersey">Jersey</option><option value="cue">Pool cue</option><option value="balls">Ball set</option><option value="scrabble">Scrabble</option><option value="darts">Dart board</option><option value="paddle">Paddles</option></select></div>'+
  '<div class="field colorf"><label for="n-c1">Main colour</label><input id="n-c1" name="c1" type="color" value="#1E3A2C"></div>'+
  '<div class="field colorf"><label for="n-c2">Accent colour</label><input id="n-c2" name="c2" type="color" value="#F2EB3C"></div>'+
  '<div class="field"><label for="n-num">Jersey number</label><input id="n-num" name="num" maxlength="3" placeholder="10"></div>'+
  '<div class="field wide"><label for="n-desc">Short description</label><input id="n-desc" name="desc"></div>'+
  '<div class="field wide"><label for="n-img">Photo (optional, replaces the illustration)</label><input id="n-img" name="img" type="file" accept="image/*"></div>'+
  '<div class="full"><p class="err" role="alert">'+esc(ui.addErr)+'</p><button class="btn y" type="submit">Add product<span class="arr">+</span></button></div></form></div>'+
  '<div class="panelc"><h3>Inventory ('+products.length+')</h3><div class="tablewrap"><table><thead><tr><th>Product</th><th>Category</th><th class="n">Price</th><th>Stock</th><th class="n">Sold</th><th></th></tr></thead><tbody>';
  products.forEach(function(p){
    var c=String(ui.confirmDel)===String(p.id);
    o+='<tr><td><div class="tn"><div class="th">'+pic(p)+'</div><b>'+esc(p.name)+'</b></div></td><td>'+esc(p.cat)+'</td><td class="n">'+money(p.price)+'</td>'+
    '<td><input class="mini" type="number" min="0" step="1" value="'+p.stock+'" data-stock="'+esc(p.id)+'" aria-label="Stock for '+esc(p.name)+'"></td><td class="n">'+(sold[p.id]||0)+'</td>'+
    '<td><button class="dangerbtn'+(c?' on':'')+'" data-action="del" data-id="'+esc(p.id)+'">'+(c?'Confirm delete':'Delete')+'</button></td></tr>';
  });
  return o+'</tbody></table></div></div>';
}
/* ---------- pool table (login page) ---------- */
var PW=800,PH=400,RAIL=30,BR=11,FL=RAIL,FR=PW-RAIL,FT=RAIL,FB=PH-RAIL;
var POCKETS=[[FL,FT,20],[PW/2,FT-2,19],[FR,FT,20],[FL,FB,20],[PW/2,FB+2,19],[FR,FB,20]];
var BCOL=['#f2c230','#2a59b8','#d33b2f','#5a2a82','#e8812c','#1f7a45','#7b1f1f','#161616','#f2c230','#2a59b8'];
var pool={balls:[],aim:null,msg:'',potted:0,running:false,scratch:false,stat:'',cnt:''};
function rack(){
  pool.balls=[{n:0,x:210,y:PH/2,vx:0,vy:0,on:true}];
  var n=1;for(var r=0;r<4;r++)for(var i=0;i<=r;i++){pool.balls.push({n:n++,x:560+r*(BR*1.74+.4),y:PH/2+(i-r/2)*(BR*2+.4),vx:0,vy:0,on:true})}
  pool.potted=0;pool.scratch=false;pool.msg='Drag back from the cue ball, then let go to shoot.';
}
rack();
function poolMoving(){return pool.balls.some(function(b){return b.on&&(b.vx||b.vy)})}
function poolStep(){
  var B=pool.balls;
  for(var s=0;s<2;s++){
    B.forEach(function(b){
      if(!b.on)return;
      b.x+=b.vx;b.y+=b.vy;b.vx*=.988;b.vy*=.988;
      if(Math.abs(b.vx)<.03&&Math.abs(b.vy)<.03){b.vx=0;b.vy=0}
      if(b.x<FL+BR){b.x=FL+BR;b.vx=Math.abs(b.vx)*.9}else if(b.x>FR-BR){b.x=FR-BR;b.vx=-Math.abs(b.vx)*.9}
      if(b.y<FT+BR){b.y=FT+BR;b.vy=Math.abs(b.vy)*.9}else if(b.y>FB-BR){b.y=FB-BR;b.vy=-Math.abs(b.vy)*.9}
    });
    for(var i=0;i<B.length;i++){var a=B[i];if(!a.on)continue;
      for(var j=i+1;j<B.length;j++){var c=B[j];if(!c.on)continue;
        var dx=c.x-a.x,dy=c.y-a.y,d2=dx*dx+dy*dy,m=2*BR;
        if(d2<m*m&&d2>0){var d=Math.sqrt(d2),nx=dx/d,ny=dy/d,ov=(m-d)/2;
          a.x-=nx*ov;a.y-=ny*ov;c.x+=nx*ov;c.y+=ny*ov;
          var rel=(a.vx-c.vx)*nx+(a.vy-c.vy)*ny;
          if(rel>0){var k=rel*.985;a.vx-=k*nx;a.vy-=k*ny;c.vx+=k*nx;c.vy+=k*ny}}}}
    B.forEach(function(b){
      if(!b.on)return;
      for(var q=0;q<POCKETS.length;q++){var p=POCKETS[q];
        if(Math.hypot(b.x-p[0],b.y-p[1])<p[2]){
          b.on=false;b.vx=0;b.vy=0;
          if(b.n===0){pool.scratch=true;pool.msg='Scratch! The cue ball returns when the table settles.'}
          else{pool.potted++;pool.msg=pool.potted>=10?'Table cleared. Hit Re-rack to play again.':'Potted ball '+b.n+'.'}
          break}}
    });
  }
  if(pool.scratch&&!poolMoving()){
    var cb=pool.balls[0];cb.x=210;cb.y=PH/2;cb.vx=0;cb.vy=0;
    var tries=0;while(tries<40&&pool.balls.some(function(o){return o!==cb&&o.on&&Math.hypot(o.x-cb.x,o.y-cb.y)<2*BR+1})){cb.x-=14;tries++}
    cb.on=true;pool.scratch=false;pool.msg='Cue ball is back on the table. Your shot.';
  }
}
function poolRay(ox,oy,dx,dy){
  var best=1e9,hit=null;
  pool.balls.forEach(function(b){
    if(!b.on||b.n===0)return;
    var fx=ox-b.x,fy=oy-b.y,bq=fx*dx+fy*dy,c=fx*fx+fy*fy-4*BR*BR,disc=bq*bq-c;
    if(disc>=0){var t=-bq-Math.sqrt(disc);if(t>0&&t<best){best=t;hit=b}}
  });
  var tw=1e9;
  if(dx>0)tw=Math.min(tw,(FR-BR-ox)/dx);else if(dx<0)tw=Math.min(tw,(FL+BR-ox)/dx);
  if(dy>0)tw=Math.min(tw,(FB-BR-oy)/dy);else if(dy<0)tw=Math.min(tw,(FT+BR-oy)/dy);
  if(tw<best){best=tw;hit=null}
  return{t:Math.max(0,best),hit:hit};
}
function rr(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath()}
function drawBall(ctx,b){
  var col=b.n===0?'#F6F3E8':BCOL[b.n-1];
  ctx.fillStyle='rgba(0,0,0,.3)';ctx.beginPath();ctx.ellipse(b.x+2,b.y+3,BR,BR*.9,0,0,7);ctx.fill();
  ctx.fillStyle=col;ctx.beginPath();ctx.arc(b.x,b.y,BR,0,7);ctx.fill();
  var g=ctx.createRadialGradient(b.x-4,b.y-4,1,b.x,b.y,BR);
  g.addColorStop(0,'rgba(255,255,255,.6)');g.addColorStop(.35,'rgba(255,255,255,0)');g.addColorStop(1,'rgba(0,0,0,.35)');
  ctx.fillStyle=g;ctx.beginPath();ctx.arc(b.x,b.y,BR,0,7);ctx.fill();
  if(b.n>0){
    ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(b.x,b.y,5.3,0,7);ctx.fill();
    ctx.fillStyle='#111';ctx.font='800 '+(b.n>9?6:7.5)+'px Archivo, Arial, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(b.n),b.x,b.y+.5);
  }
}
function aimInfo(){
  var c=pool.balls[0];if(!pool.aim||!c.on||poolMoving())return null;
  var dx=c.x-pool.aim.x,dy=c.y-pool.aim.y,d=Math.hypot(dx,dy);
  return{dx:dx,dy:dy,d:d,len:Math.min(d,160)};
}
function poolDraw(cv){
  var ctx=cv.getContext('2d'),s=cv.width/PW;
  ctx.setTransform(s,0,0,s,0,0);ctx.clearRect(0,0,PW,PH);ctx.lineCap='round';
  rr(ctx,0,0,PW,PH,26);ctx.fillStyle='#2A2F2A';ctx.fill();
  rr(ctx,3,3,PW-6,PH-6,24);ctx.strokeStyle='rgba(255,255,255,.12)';ctx.lineWidth=2;ctx.stroke();
  rr(ctx,FL-8,FT-8,FR-FL+16,FB-FT+16,12);
  var fg=ctx.createRadialGradient(PW/2,PH/2,30,PW/2,PH/2,470);fg.addColorStop(0,'#2D7A5D');fg.addColorStop(1,'#1B4F3C');ctx.fillStyle=fg;ctx.fill();
  ctx.fillStyle='#D9D4B8';
  for(var i=1;i<8;i++){if(i===4)continue;var x=FL+(FR-FL)*i/8;ctx.beginPath();ctx.arc(x,RAIL/2-1,2.6,0,7);ctx.fill();ctx.beginPath();ctx.arc(x,PH-RAIL/2+1,2.6,0,7);ctx.fill()}
  for(var j=1;j<4;j++){var y=FT+(FB-FT)*j/4;ctx.beginPath();ctx.arc(RAIL/2-1,y,2.6,0,7);ctx.fill();ctx.beginPath();ctx.arc(PW-RAIL/2+1,y,2.6,0,7);ctx.fill()}
  ctx.fillStyle='rgba(255,255,255,.2)';[210,560].forEach(function(px){ctx.beginPath();ctx.arc(px,PH/2,3,0,7);ctx.fill()});
  POCKETS.forEach(function(p){var pg=ctx.createRadialGradient(p[0],p[1],2,p[0],p[1],p[2]);pg.addColorStop(0,'#000');pg.addColorStop(1,'#0C0F0C');ctx.fillStyle=pg;ctx.beginPath();ctx.arc(p[0],p[1],p[2],0,7);ctx.fill()});
  pool.balls.slice(1).forEach(function(b){if(b.on)drawBall(ctx,b)});
  var cue=pool.balls[0];if(cue.on)drawBall(ctx,cue);
  var ai=aimInfo();
  if(ai&&ai.d>6){
    var ux=ai.dx/ai.d,uy=ai.dy/ai.d,r=poolRay(cue.x,cue.y,ux,uy),gx=cue.x+ux*r.t,gy=cue.y+uy*r.t;
    ctx.setLineDash([6,6]);ctx.strokeStyle='rgba(255,255,255,.8)';ctx.lineWidth=1.6;
    ctx.beginPath();ctx.moveTo(cue.x+ux*BR,cue.y+uy*BR);ctx.lineTo(gx,gy);ctx.stroke();
    ctx.beginPath();ctx.arc(gx,gy,BR,0,7);ctx.stroke();
    if(r.hit){var hx=r.hit.x-gx,hy=r.hit.y-gy,hl=Math.hypot(hx,hy)||1;ctx.beginPath();ctx.moveTo(r.hit.x,r.hit.y);ctx.lineTo(r.hit.x+hx/hl*40,r.hit.y+hy/hl*40);ctx.stroke()}
    ctx.setLineDash([]);
    var gap=BR+5+ai.len*.45,sx=cue.x-ux*gap,sy=cue.y-uy*gap;
    function seg(a,b,col,w){ctx.strokeStyle=col;ctx.lineWidth=w;ctx.beginPath();ctx.moveTo(sx-ux*a,sy-uy*a);ctx.lineTo(sx-ux*b,sy-uy*b);ctx.stroke()}
    seg(0,5,'#5AA0C8',5);seg(5,15,'#F4F1E8',5);seg(15,190,'#E4C98A',5.5);seg(190,300,'#2A1D14',8);seg(205,216,'#F2EB3C',8);
  }
}
function poolText(id,key,t){if(pool[key]===t)return;pool[key]=t;var el=document.getElementById(id);if(el)el.textContent=t}
function poolLoop(){
  var cv=document.getElementById('pool');
  if(!cv){pool.running=false;return}
  var w=cv.clientWidth;
  if(w>0){
    var dpr=Math.min(window.devicePixelRatio||1,2),pw=Math.round(w*dpr),ph=Math.round(w/2*dpr);
    if(cv.width!==pw||cv.height!==ph){cv.width=pw;cv.height=ph}
    poolStep();poolDraw(cv);
    var ai=aimInfo(),txt;
    if(ai)txt=ai.d<10?'Pull back further to aim':'Power '+Math.round(ai.len/160*100)+'%';
    else if(poolMoving())txt='Rolling…';
    else txt=pool.msg;
    poolText('poolstat','stat',txt);
    poolText('poolcount','cnt','Potted '+pool.potted+' / 10');
  }
  requestAnimationFrame(poolLoop);
}
function bindPool(){
  var cv=document.getElementById('pool');if(!cv)return;
  function pt(e){var r=cv.getBoundingClientRect();return{x:(e.clientX-r.left)/r.width*PW,y:(e.clientY-r.top)/r.height*PH}}
  cv.addEventListener('pointerdown',function(e){
    if(poolMoving()||!pool.balls[0].on)return;
    e.preventDefault();try{cv.setPointerCapture(e.pointerId)}catch(x){}
    pool.aim=pt(e);
  });
  cv.addEventListener('pointermove',function(e){if(pool.aim)pool.aim=pt(e)});
  function release(e){
    var ai=aimInfo();pool.aim=null;
    if(!ai)return;
    if(ai.d<10){pool.msg='Drag further back to take a shot.';return}
    var c=pool.balls[0],sp=ai.len/160*13.5;
    c.vx=ai.dx/ai.d*sp;c.vy=ai.dy/ai.d*sp;pool.msg='';
  }
  cv.addEventListener('pointerup',release);
  cv.addEventListener('pointercancel',function(){pool.aim=null});
  pool.stat='';pool.cnt='';
  if(!pool.running){pool.running=true;requestAnimationFrame(poolLoop)}
}

/* ---------- 3D tilt and parallax ---------- */
var calm=!!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches);
var activePic=null;
function tiltHero(e){
  var h=$('.hero'),st=$('.stage'),big=$('.stage .big');if(!h||!st||!big)return;
  var r=h.getBoundingClientRect(),x=0,y=0;
  if(e&&e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom){x=((e.clientX-r.left)/r.width-.5)*2;y=((e.clientY-r.top)/r.height-.5)*2}
  st.style.setProperty('--px',x.toFixed(3));st.style.setProperty('--py',y.toFixed(3));
  big.style.setProperty('--rx',(-y*8).toFixed(2)+'deg');big.style.setProperty('--ry',(x*14).toFixed(2)+'deg');
}
function resetPic(p){['--rx','--ry'].forEach(function(k){p.style.setProperty(k,'0deg')});['--ix','--iy'].forEach(function(k){p.style.setProperty(k,'0')});p.classList.remove('hot')}
function tiltPic(e){
  var p=e.target.closest?e.target.closest('.prod .pic'):null;
  if(activePic&&activePic!==p)resetPic(activePic);
  activePic=p;if(!p)return;
  var r=p.getBoundingClientRect(),x=((e.clientX-r.left)/r.width-.5)*2,y=((e.clientY-r.top)/r.height-.5)*2;
  p.classList.add('hot');
  p.style.setProperty('--rx',(-y*10).toFixed(2)+'deg');p.style.setProperty('--ry',(x*12).toFixed(2)+'deg');
  p.style.setProperty('--ix',x.toFixed(3));p.style.setProperty('--iy',y.toFixed(3));
  p.style.setProperty('--gx',((x+1)*50).toFixed(1)+'%');p.style.setProperty('--gy',((y+1)*50).toFixed(1)+'%');
}
document.addEventListener('pointermove',function(e){if(calm||e.pointerType==='touch')return;tiltHero(e);tiltPic(e)});
document.documentElement.addEventListener('mouseleave',function(){tiltHero(null);if(activePic){resetPic(activePic);activePic=null}});
/* ---------- actions ---------- */
function cartQty(id){for(var i=0;i<cart.length;i++)if(cart[i].id===id)return cart[i].qty;return 0}
function setQty(id,q){var p=pById(id);if(!p)return;q=Math.min(q,p.stock);cart=cart.filter(function(c){return c.id!==id});if(q>0)cart.push({id:id,qty:q});saveCart()}
function updateNavCount(){var b=document.querySelector('.nav .pillbtn.solid[data-action="openCart"]');if(b)b.textContent='Cart ('+cartCount()+')'}
function formMsg(f,m){var e=f.querySelector('.err');if(e)e.textContent=m||''}
function formBusy(f,on){var b=f.querySelector('[type="submit"]');if(b)b.disabled=!!on;ui.busy=!!on}
function lockDetails(f){['name','phone','addr'].forEach(function(n){if(f.elements[n])f.elements[n].disabled=true})}
function finishOrder(order){
  cart=[];saveCart();ui.pending=null;ui.lastOrder=order;ui.modal='success';ui.cartOpen=false;
  render();loadProducts().then(render).catch(function(){});
}
function afterLogin(){
  admin.loaded=false;admin.summary=null;
  if(session.role==='admin'){
    ui.tab='overview';
    return api('GET','/api/me').then(function(r){defaultPw=!!r.defaultPassword;go('admin')});
  }
  if(ui.returnTo&&cartLines().length){ui.modal='checkout';ui.cartOpen=false}
  ui.returnTo=false;go('');
}

var actions={
  add:function(el){var id=Number(el.dataset.id),p=pById(id);if(!p)return;if(cartQty(id)>=p.stock){toast('That is all we have in stock.');return}setQty(id,cartQty(id)+1);toast('Added '+p.name+' to cart');updateNavCount()},
  inc:function(el){var id=Number(el.dataset.id);setQty(id,cartQty(id)+1);render()},
  dec:function(el){var id=Number(el.dataset.id);setQty(id,cartQty(id)-1);render()},
  rm:function(el){setQty(Number(el.dataset.id),0);render()},
  openCart:function(){ui.cartOpen=true;render()},
  closeCart:function(){ui.cartOpen=false;render()},
  closeModal:function(){
    var p=ui.pending;ui.modal=null;ui.pending=null;ui.busy=false;render();
    if(p)api('POST','/api/orders/'+encodeURIComponent(p.id)+'/cancel').then(loadProducts).then(render).catch(function(){});
  },
  filter:function(el){ui.filter=el.dataset.cat;$('#chips').innerHTML=chipsHtml();$('#grid').innerHTML=gridHtml()},
  catlink:function(el){ui.filter=el.dataset.cat;render();var s=$('#shop');if(s)s.scrollIntoView({behavior:'smooth'})},
  scroll:function(el){var s=document.getElementById(el.dataset.to);if(s)s.scrollIntoView({behavior:'smooth'})},
  toLogin:function(){ui.authTab='login';go('login')},
  toStore:function(){go('')},
  toAdmin:function(){go('admin')},
  rerack:function(){rack();pool.aim=null},
  spin:function(el){el.classList.remove('go');void el.offsetWidth;el.classList.add('go');el.addEventListener('animationend',function f(ev){if(ev.animationName==='spinY'){el.classList.remove('go');el.removeEventListener('animationend',f)}})},
  gateLogin:function(){ui.returnTo=true;ui.cartOpen=false;ui.authTab='login';go('login')},
  gateSignup:function(){ui.returnTo=true;ui.cartOpen=false;ui.authTab='signup';go('login')},
  authtab:function(el){ui.authTab=el.dataset.t;render()},
  logout:function(){
    api('POST','/api/logout').catch(function(){}).then(function(){
      session=null;defaultPw=false;admin.loaded=false;admin.summary=null;admin.orders=[];ui.tab='overview';ui.modal=null;go('');
    });
  },
  checkout:function(){
    if(!cartLines().length)return;
    if(!session){render();return}
    ui.cartOpen=false;ui.modal='checkout';ui.pending=null;render();
  },
  myOrders:function(){
    ui.modal='orders';ui.myOrders=null;render();
    api('GET','/api/my/orders').then(function(r){ui.myOrders=r;if(ui.modal==='orders')render()}).catch(function(e){ui.modal=null;render();toast(e.message)});
  },
  tab:function(el){ui.tab=el.dataset.t;ui.confirmDel=null;ui.pwMsg='';render()},
  retryAdmin:function(){refreshAdmin();render()},
  del:function(el){
    var id=el.dataset.id;
    if(String(ui.confirmDel)!==id){ui.confirmDel=id;render();return}
    ui.confirmDel=null;
    api('DELETE','/api/admin/products/'+encodeURIComponent(id)).then(function(){toast('Product deleted');return loadProducts()}).then(function(){refreshAdmin();render()}).catch(function(e){toast(e.message);render()});
  },
  clearSample:function(){api('POST','/api/admin/sample-orders/clear').then(function(r){toast(r.removed+' sample orders removed');refreshAdmin()}).catch(function(e){toast(e.message)})}
};

function readImg(file){return new Promise(function(res,rej){var fr=new FileReader();fr.onload=function(){var im=new Image();im.onload=function(){var s=Math.min(1,700/Math.max(im.width,im.height)),c=document.createElement('canvas');c.width=Math.round(im.width*s);c.height=Math.round(im.height*s);c.getContext('2d').drawImage(im,0,0,c.width,c.height);res(c.toDataURL('image/jpeg',.82))};im.onerror=rej;im.src=fr.result};fr.onerror=rej;fr.readAsDataURL(file)})}

var forms={
  login:function(f){
    var email=fv(f,'email').trim(),pw=fv(f,'pw');
    if(!email||!pw){formMsg(f,'Enter your email and password.');return}
    formBusy(f,true);formMsg(f,'');
    api('POST','/api/login',{email:email,password:pw}).then(function(r){session=r.user;return afterLogin()}).catch(function(e){formBusy(f,false);formMsg(f,e.message)});
  },
  signup:function(f){
    var name=fv(f,'name').trim(),email=fv(f,'email').trim(),pw=fv(f,'pw');
    if(!name||!email||!pw){formMsg(f,'Fill in your name, email and a password.');return}
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){formMsg(f,'Enter a valid email address.');return}
    if(pw.length<8){formMsg(f,'Use a password with at least 8 characters.');return}
    formBusy(f,true);formMsg(f,'');
    api('POST','/api/signup',{name:name,email:email,password:pw}).then(function(r){session=r.user;return afterLogin()}).catch(function(e){formBusy(f,false);formMsg(f,e.message)});
  },
  checkout:function(f){
    if(ui.busy)return;
    var sim=cfg.payment==='simulated',card=null,name='',addr='';
    if(!ui.pending){
      name=fv(f,'name').trim();addr=fv(f,'addr').trim();
      if(!name||addr.length<5){formMsg(f,'Enter your name and a full delivery address.');return}
    }
    if(sim){
      card={card:fv(f,'card'),exp:fv(f,'exp'),cvc:fv(f,'cvc')};
      if(!card.card.trim()||!card.exp.trim()||!card.cvc.trim()){formMsg(f,'Enter your card number, expiry and CVC.');return}
    }
    var begin;
    if(ui.pending){begin=Promise.resolve({order:ui.pending})}
    else{
      begin=api('POST','/api/checkout',{name:name,phone:fv(f,'phone').trim(),address:addr,items:cart.map(function(c){return{id:c.id,qty:c.qty}})});
    }
    formBusy(f,true);formMsg(f,'');
    begin.then(function(r){
      if(r.placed){ui.pending=null;finishOrder(r.order);return}
      ui.pending=r.order;
      if(r.redirect){window.location.href=r.redirect;return}
      return api('POST','/api/orders/'+encodeURIComponent(r.order.id)+'/simulate-pay',card).then(function(p){finishOrder(p.order)});
    }).catch(function(e){
      formBusy(f,false);
      if(e.login){session=null;ui.modal=null;go('login');return}
      if(e.status===409){loadProducts().then(function(){updateNavCount()}).catch(function(){})}
      if(ui.pending)lockDetails(f);
      formMsg(f,e.message);
    });
  },
  addproduct:function(f){
    var name=fv(f,'name').trim(),cat=fv(f,'cat').trim(),price=parseFloat(fv(f,'price')),stock=parseInt(fv(f,'stock'),10);
    if(!name||!cat||isNaN(price)||price<0||isNaN(stock)||stock<0){formMsg(f,'Add a name, category, price and stock count.');return}
    var file=f.elements.img&&f.elements.img.files&&f.elements.img.files[0];
    formBusy(f,true);formMsg(f,'');
    var make=function(img){
      var body={name:name,cat:cat,price:price,stock:stock,art:fv(f,'art'),c1:fv(f,'c1'),c2:fv(f,'c2'),num:fv(f,'num').trim(),desc:fv(f,'desc').trim()};
      if(img)body.image=img;
      return api('POST','/api/admin/products',body);
    };
    (file?readImg(file):Promise.resolve('')).catch(function(){throw new Error('That image could not be read. Try a JPG or PNG.')})
      .then(make).then(function(){toast('Product added to the store');return loadProducts()}).then(function(){refreshAdmin();render()})
      .catch(function(e){formBusy(f,false);formMsg(f,e.message)});
  },
  password:function(f){
    var cur=fv(f,'current'),nxt=fv(f,'next');
    if(!cur||nxt.length<8){formMsg(f,'Enter your current password and a new one with 8 or more characters.');return}
    formBusy(f,true);formMsg(f,'');
    api('POST','/api/admin/password',{current:cur,next:nxt}).then(function(){defaultPw=false;ui.pwMsg='Password changed.';render()}).catch(function(e){formBusy(f,false);formMsg(f,e.message)});
  }
};

document.addEventListener('click',function(e){var el=e.target.closest('[data-action]');if(!el||el.disabled)return;var a=actions[el.dataset.action];if(a)a(el)});
document.addEventListener('submit',function(e){var f=e.target.closest('form[data-form]');if(!f)return;e.preventDefault();var h=forms[f.dataset.form];if(h)h(f)});
document.addEventListener('input',function(e){if(e.target.id==='q'){ui.q=e.target.value;var g=$('#grid');if(g)g.innerHTML=gridHtml()}});
document.addEventListener('change',function(e){
  var t=e.target;if(!t.dataset)return;
  if(t.dataset.stock){
    var v=parseInt(t.value,10);if(isNaN(v)||v<0)v=0;
    api('PATCH','/api/admin/products/'+encodeURIComponent(t.dataset.stock),{stock:v}).then(function(r){var p=pById(r.product.id);if(p)p.stock=r.product.stock;toast('Stock updated');refreshAdmin()}).catch(function(err){toast(err.message);render()});
  }
  if(t.dataset.status){
    var code=t.dataset.status;
    api('PATCH','/api/admin/orders/'+encodeURIComponent(code),{status:t.value}).then(function(){toast('Order '+code+' set to '+t.value);return loadProducts()}).then(function(){refreshAdmin()}).catch(function(err){toast(err.message);refreshAdmin();render()});
  }
});
document.addEventListener('keydown',function(e){if(e.key==='Escape'){if(ui.modal)actions.closeModal();else if(ui.cartOpen){ui.cartOpen=false;render()}}});
window.addEventListener('hashchange',function(){window.scrollTo(0,0);render()});

/* ---------- start ---------- */
function handlePaymentReturn(){
  var q=new URLSearchParams(location.search),outcome=q.get('payment'),code=q.get('order');
  if(!outcome)return;
  try{history.replaceState(null,'',location.pathname+location.hash)}catch(e){}
  if(outcome==='paid'){cart=[];saveCart();ui.lastOrder={id:code,customer:session?session.name:'',total:null};ui.modal='success'}
  else if(outcome==='cancelled')toast('Payment cancelled. Your cart is still here.');
  else toast('We could not confirm that payment. If you were charged, contact us with order '+code+'.');
}
Promise.all([api('GET','/api/config'),api('GET','/api/me'),api('GET','/api/products')]).then(function(r){
  cfg=r[0];setFmt();session=r[1].user;defaultPw=!!r[1].defaultPassword;products=r[2];syncCart();handlePaymentReturn();render();
}).catch(function(){
  app.innerHTML='<div class="wrap" style="padding-block:80px"><h1 style="font:800 32px var(--display);text-transform:uppercase">Fricco is not reachable</h1><p class="muted">We could not load the shop. Refresh the page in a moment.</p></div>';
});
})();
