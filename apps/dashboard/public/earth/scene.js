import * as T from './vendor/three.module.min.js';
import {COLORS,hash} from './data.js';

const RAD=Math.PI/180, UP=new T.Vector3(0,1,0);
const spherical=(lon,lat,r=1)=>new T.Vector3(r*Math.cos(lat*RAD)*Math.sin(lon*RAD),r*Math.sin(lat*RAD),r*Math.cos(lat*RAD)*Math.cos(lon*RAD));
// Positions are a stable network layout derived only from ID, never geography.
function agentPosition(id) { return spherical(-92+(hash(id)%10000)/10000*122,-37+(hash(id+':latitude')%10000)/10000*90,2.57); }
function random(seed=402){return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
function glowTexture(){const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d');const g=x.createRadialGradient(32,32,0,32,32,32);g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(.16,'rgba(255,255,255,.7)');g.addColorStop(.5,'rgba(255,255,255,.12)');g.addColorStop(1,'rgba(255,255,255,0)');x.fillStyle=g;x.fillRect(0,0,64,64);return new T.CanvasTexture(c);}

export async function createEarth({canvas,labels,onAgent,onHover,onReady,onFailure}) {
  const mobile=matchMedia('(max-width:680px)').matches;
  const reduced=matchMedia('(prefers-reduced-motion:reduce)');
  const renderer=new T.WebGLRenderer({canvas,antialias:!mobile,alpha:true,powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,mobile?1.25:1.65));
  renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.25;
  const scene=new T.Scene(),camera=new T.PerspectiveCamera(38,1,.1,100);
  const earth=new T.Group();earth.rotation.set(.12,.60,-.055);earth.position.x=-.16;scene.add(earth);
  scene.add(new T.HemisphereLight(0xc9eaff,0x153e62,2.15));
  const sun=new T.DirectionalLight(0xfff3de,3.5);sun.position.set(-4,7,6);scene.add(sun);
  const rim=new T.DirectionalLight(0x168cff,2);rim.position.set(5,1,-4);scene.add(rim);
  const sphere=new T.SphereGeometry(1,24,16),glow=glowTexture();
  function mesh(geometry,material,parent,position=[0,0,0],scale=[1,1,1]) {const m=new T.Mesh(geometry,material);m.position.set(...position);m.scale.set(...scale);parent.add(m);return m;}
  const oceanMaterial=new T.MeshPhysicalMaterial({color:0x087ada,roughness:.38,metalness:.12,clearcoat:.55,clearcoatRoughness:.4});
  mesh(new T.SphereGeometry(2.48,mobile?96:144,80),oceanMaterial,earth);
  // A Fresnel atmosphere provides the luminous limb without a fullscreen postprocess.
  const atmosphere=new T.ShaderMaterial({transparent:true,depthWrite:false,side:T.BackSide,blending:T.AdditiveBlending,uniforms:{tint:{value:new T.Color('#1bb8ff')}},vertexShader:'varying vec3 n; varying vec3 v; void main(){vec4 p=modelViewMatrix*vec4(position,1.0); n=normalize(normalMatrix*normal);v=normalize(-p.xyz);gl_Position=projectionMatrix*p;}',fragmentShader:'uniform vec3 tint;varying vec3 n;varying vec3 v;void main(){float a=pow(max(0.0,0.72-dot(n,v)),3.4);gl_FragColor=vec4(tint,clamp(a,0.0,0.52));}'});
  mesh(new T.SphereGeometry(2.565,80,48),atmosphere,earth);
  const landResponse=await fetch('/earth/vendor/land.json');if(!landResponse.ok)throw new Error('Land asset unavailable');
  const geo=await landResponse.json();
  const map=document.createElement('canvas');map.width=2048;map.height=1024;const ctx=map.getContext('2d',{willReadFrequently:true});
  const drawGeometry=g=>{const polys=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];for(const polygon of polys){ctx.beginPath();for(const ring of polygon){for(let i=0;i<ring.length;i++){const [lon,lat]=ring[i],x=(lon+180)/360*map.width,y=(90-lat)/180*map.height;i?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.closePath();}ctx.fill('evenodd');}};
  ctx.fillStyle='#fff';if(geo.type==='FeatureCollection')geo.features.forEach(f=>drawGeometry(f.geometry));else drawGeometry(geo.geometry||geo);
  const pixels=ctx.getImageData(0,0,map.width,map.height).data;
  const landAt=(lon,lat)=>{const x=Math.min(2047,Math.max(0,Math.floor((lon+180)/360*2048))),y=Math.min(1023,Math.max(0,Math.floor((90-lat)/180*1024)));return pixels[(y*2048+x)*4+3]>127;};
  const terrain=new T.SphereGeometry(2.5,mobile?180:288,mobile?100:160).toNonIndexed();
  const pos=terrain.attributes.position,colors=new Float32Array(pos.count*3),color=new T.Color(),v=new T.Vector3();
  for(let i=0;i<pos.count;i++) {
    v.fromBufferAttribute(pos,i).normalize();const lon=Math.atan2(v.x,v.z)/RAD,lat=Math.asin(v.y)/RAD;
    const land=landAt(lon,lat);const detail=(Math.sin(lon*.72)*Math.sin(lat*.64)+Math.sin(lon*1.7+lat)*.35)*.5+.5;
    const mountain=Math.pow(Math.max(0,Math.sin(lon*.21+lat*.18)*Math.cos(lat*.31)),6);
    const radius=land?2.507+detail*.020+mountain*.038:2.466;
    pos.setXYZ(i,v.x*radius,v.y*radius,v.z*radius);
    if(Math.abs(lat)>68 && land) color.setHSL(.56,.26,.85+detail*.07);
    else if(lat>10&&lat<35&&lon>-20&&lon<67) color.setHSL(.105,.50,.51+detail*.11);
    else if(lat < -18&&lon>110) color.setHSL(.10,.45,.5+detail*.10);
    else color.setHSL(.23+detail*.045,.52,.29+detail*.15+mountain*.06);
    colors.set([color.r,color.g,color.b],i*3);
  }
  terrain.setAttribute('color',new T.BufferAttribute(colors,3));terrain.computeVertexNormals();
  mesh(terrain,new T.MeshStandardMaterial({vertexColors:true,roughness:.87,flatShading:true}),earth);
  // Instanced trees provide raised, playful terrain without hundreds of draw calls.
  const rng=random(),treeCount=mobile?260:720,treeGeometry=new T.ConeGeometry(.026,.10,5),trees=new T.InstancedMesh(treeGeometry,new T.MeshStandardMaterial({color:0x68b74a,roughness:.9,flatShading:true}),treeCount);
  const dummy=new T.Object3D();let placed=0;
  for(let tries=0;tries<treeCount*30 && placed<treeCount;tries++) {const lon=rng()*360-180,lat=rng()*120-55;if(!landAt(lon,lat)||(lat>8&&lat<36&&lon>-20&&lon<70))continue;const n=spherical(lon,lat);dummy.position.copy(n).multiplyScalar(2.565);dummy.quaternion.setFromUnitVectors(UP,n);dummy.scale.setScalar(.6+rng()*.9);dummy.updateMatrix();trees.setMatrixAt(placed,dummy.matrix);trees.setColorAt(placed,new T.Color().setHSL(.23+rng()*.1,.5,.27+rng()*.15));placed++;}trees.count=placed;earth.add(trees);
  const clouds=new T.Group();earth.add(clouds);const cloudMat=new T.MeshStandardMaterial({color:0xe9f5ff,roughness:1});
  for(let i=0;i<(mobile?9:16);i++){const cluster=new T.Group(),n=spherical(rng()*360-180,rng()*115-55);cluster.position.copy(n).multiplyScalar(2.62);cluster.quaternion.setFromUnitVectors(UP,n);for(let j=0;j<4;j++)mesh(sphere,cloudMat,cluster,[(j-1.5)*.11,.04+rng()*.05,0],[.11,.07+rng()*.08,.09]);clouds.add(cluster);}
  const starCount=mobile?280:800,starsPos=new Float32Array(starCount*3),starsColor=new Float32Array(starCount*3);
  for(let i=0;i<starCount;i++){starsPos.set([(rng()-.5)*30,(rng()-.5)*20,-6-rng()*15],i*3);const c=new T.Color().setHSL(.56+rng()*.12,.35,.55+rng()*.4);starsColor.set([c.r,c.g,c.b],i*3);}
  const starsGeo=new T.BufferGeometry();starsGeo.setAttribute('position',new T.BufferAttribute(starsPos,3));starsGeo.setAttribute('color',new T.BufferAttribute(starsColor,3));scene.add(new T.Points(starsGeo,new T.PointsMaterial({size:.075,map:glow,transparent:true,vertexColors:true,depthWrite:false,blending:T.AdditiveBlending})));
  for(let i=0;i<9;i++){const s=new T.Sprite(new T.SpriteMaterial({map:glow,color:0x6aafff,transparent:true,blending:T.AdditiveBlending,depthWrite:false}));s.position.set((rng()-.5)*16,(rng()-.5)*10,-3);s.scale.setScalar(.10+rng()*.13);scene.add(s);}
  // A distant moon is scenery, never an agent or fabricated network relationship.
  const moon=mesh(new T.IcosahedronGeometry(.34,3),new T.MeshStandardMaterial({color:0x7b8caa,roughness:1,flatShading:true}),scene,[4.8,-.9,-2]);
  const robotRoot=new T.Group(),arcRoot=new T.Group();earth.add(robotRoot,arcRoot);
  const ringGeometry=new T.TorusGeometry(.165,.012,8,40),diskGeometry=new T.CylinderGeometry(.16,.16,.015,32),limbGeometry=new T.CapsuleGeometry(.036,.09,3,8);
  const robots=[],raycaster=new T.Raycaster(),pointer=new T.Vector2();let activeHover=null,lastHover=null;
  function robot(agent) {
    const root=new T.Group(),body=new T.Group(),accent=new T.Color(COLORS[agent.type]);
    const shell=new T.MeshStandardMaterial({color:0xd9e6f3,metalness:.22,roughness:.29}),trim=new T.MeshStandardMaterial({color:accent,metalness:.35,roughness:.3});
    const dark=new T.MeshStandardMaterial({color:0x020b1c,metalness:.4,roughness:.18});
    const light=new T.MeshBasicMaterial({color:accent.clone().multiplyScalar(2.1),toneMapped:false});
    const ring=mesh(ringGeometry,light,root,[0,.02,0]);ring.rotation.x=Math.PI/2;mesh(diskGeometry,new T.MeshBasicMaterial({color:accent,transparent:true,opacity:.28}),root,[0,.004,0]);
    const halo=new T.Sprite(new T.SpriteMaterial({map:glow,color:accent,transparent:true,opacity:.55,blending:T.AdditiveBlending,depthWrite:false}));halo.position.y=.015;halo.scale.set(.65,.65,.65);root.add(halo);
    root.add(body);
    mesh(sphere,shell,body,[0,.23,0],[.09,.11,.065]);mesh(sphere,trim,body,[0,.215,.058],[.043,.057,.019]);
    mesh(sphere,shell,body,[0,.41,0],[.14,.12,.095]);mesh(sphere,dark,body,[0,.41,.075],[.111,.073,.035]);
    for(const x of [-.044,.044]){mesh(sphere,light,body,[x,.42,.104],[.019,.027,.012]);const eye=new T.Sprite(new T.SpriteMaterial({map:glow,color:accent,transparent:true,blending:T.AdditiveBlending,depthWrite:false}));eye.position.set(x,.42,.12);eye.scale.setScalar(.09);body.add(eye);}
    for(const sign of [-1,1]) {mesh(sphere,trim,body,[sign*.142,.41,0],[.023,.048,.047]);const arm=mesh(limbGeometry,shell,body,[sign*.118,.245,0]);arm.rotation.z=sign*.27;mesh(sphere,trim,body,[sign*.14,.17,.005],[.04,.037,.037]);mesh(limbGeometry,trim,body,[sign*.047,.10,0],[.8,.7,.8]);mesh(sphere,shell,body,[sign*.047,.045,.028],[.048,.029,.067]);}
    mesh(new T.CylinderGeometry(.007,.007,.055,6),trim,body,[0,.54,0]);mesh(sphere,light,body,[0,.574,0],[.016,.016,.016]);
    const normal=agentPosition(agent.id).normalize();root.position.copy(normal).multiplyScalar(2.59);root.quaternion.setFromUnitVectors(UP,normal);root.scale.setScalar(mobile?.78:1);
    // Face outward toward the initial camera while standing normal to the Earth.
    const front=new T.Vector3(0,0,1).applyQuaternion(root.quaternion.clone().invert());body.rotation.y=Math.atan2(front.x,front.z);
    root.traverse(o=>o.userData.agentId=agent.id);robotRoot.add(root);
    const label=document.createElement('button');label.className='marker-label';label.style.setProperty('--color',COLORS[agent.type]);label.setAttribute('aria-label',`Inspect ${agent.name}`);const title=document.createElement('b');title.textContent=agent.name;const small=document.createElement('small');small.textContent=agent.classificationInfo.label;label.append(title,small);label.onclick=()=>onAgent(agent.id);labels.append(label);
    return {root,body,ring,label,agent};
  }
  function disposeGroup(group){const geometries=new Set(),materials=new Set();group.traverse(o=>{if(o.geometry&&!([sphere,ringGeometry,diskGeometry,limbGeometry].includes(o.geometry)))geometries.add(o.geometry);if(o.material)materials.add(o.material);});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());group.clear();}
  let signature='';
  function update(agents,links) {
    const next=JSON.stringify([agents.map(a=>[a.id,a.name,a.type,a.classificationInfo.label]),links]);if(next===signature)return;signature=next;
    disposeGroup(robotRoot);disposeGroup(arcRoot);robots.length=0;labels.replaceChildren();
    const shown=[...agents].sort((a,b)=>hash(a.id)-hash(b.id)).slice(0,mobile?12:24);for(const agent of shown)robots.push(robot(agent));
    const byId=new Map(robots.map(r=>[r.agent.id,r.root]));
    for(const link of links.slice(0,mobile?10:24)) {const a=byId.get(link.from),b=byId.get(link.to);if(!a||!b)continue;const start=a.position.clone(),end=b.position.clone(),points=[];for(let i=0;i<=40;i++){const t=i/40;const p=start.clone().lerp(end,t).normalize().multiplyScalar(2.62+Math.sin(t*Math.PI)*.48);points.push(p);}const curve=new T.CatmullRomCurve3(points);mesh(new T.TubeGeometry(curve,40,.007,5,false),new T.MeshBasicMaterial({color:0x5cf0ff,toneMapped:false}),arcRoot);const bead=mesh(sphere,new T.MeshBasicMaterial({color:0xc4ffff,toneMapped:false}),arcRoot,curve.getPoint(.46).toArray(),[.023,.023,.023]);bead.userData.curve=curve;}
  }
  let paused=reduced.matches,visible=true,drag=null,zoom=1,width=0,height=0,last=0,frameId=0,failed=false;
  const worldPos=new T.Vector3(),cameraDirection=new T.Vector3();
  function resize(){const r=canvas.getBoundingClientRect();width=r.width;height=r.height;renderer.setSize(width,height,false);camera.aspect=width/height;const minDistance=mobile?10.6:8.1;camera.position.set(0,mobile?.15:.08,Math.max(minDistance,2.8/(Math.tan(19*RAD)*camera.aspect))/zoom);camera.lookAt(0,0,0);camera.updateProjectionMatrix();}
  const observer=new ResizeObserver(resize);observer.observe(canvas);resize();
  function render(t=0){if(failed)return;frameId=requestAnimationFrame(render);if(!visible||document.hidden)return;if(t-last<(mobile?33:24))return;const delta=Math.min((t-last)/1000,.06);last=t;
    if(!paused&&!drag&&!activeHover){earth.rotation.y+=delta*.022;clouds.rotation.y+=delta*.006;}
    earth.updateMatrixWorld();cameraDirection.copy(camera.position).sub(earth.position).normalize();
    for(const r of robots){if(!paused)r.body.position.y=Math.sin(t*.0017+(hash(r.agent.id)%30))*.008;r.root.getWorldPosition(worldPos);const normal=worldPos.clone().sub(earth.position).normalize();const front=normal.dot(cameraDirection)>.23;const projected=worldPos.clone().addScaledVector(normal,.43).project(camera);const x=(projected.x*.5+.5)*width,y=(-projected.y*.5+.5)*height;const unobscured=mobile||(x>width*.22&&x<width*.77);r.label.hidden=!front||!unobscured||y<45||y>height-90;r.label.style.left=x+'px';r.label.style.top=y+'px';}
    renderer.render(scene,camera);
  }
  function pick(e){const box=canvas.getBoundingClientRect();pointer.set((e.clientX-box.left)/box.width*2-1,-(e.clientY-box.top)/box.height*2+1);raycaster.setFromCamera(pointer,camera);const hits=raycaster.intersectObjects(robotRoot.children,true);for(const hit of hits){const id=hit.object.userData.agentId,r=robots.find(r=>r.agent.id===id);if(r){r.root.getWorldPosition(worldPos);if(worldPos.sub(earth.position).normalize().dot(cameraDirection)>.18)return id;}}return null;}
  canvas.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY};canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener('pointermove',e=>{if(drag){earth.rotation.y+=(e.clientX-drag.x)*.005;earth.rotation.x=T.MathUtils.clamp(earth.rotation.x+(e.clientY-drag.y)*.003,-.65,.65);drag.x=e.clientX;drag.y=e.clientY;}else{activeHover=pick(e);canvas.style.cursor=activeHover?'pointer':'grab';if(activeHover!==lastHover){lastHover=activeHover;onHover?.(activeHover);}}});
  canvas.addEventListener('pointerup',e=>{if(drag&&Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)<7){const id=pick(e);if(id)onAgent(id);}drag=null;});
  canvas.addEventListener('pointercancel',()=>drag=null);canvas.addEventListener('lostpointercapture',()=>drag=null);canvas.addEventListener('pointerleave',()=>{activeHover=null;onHover?.(null);});
  function zoomBy(amount){zoom=T.MathUtils.clamp(zoom+amount,.78,1.25);resize();}
  canvas.addEventListener('wheel',e=>{if(mobile)return;e.preventDefault();zoomBy(-e.deltaY*.00045);},{passive:false});
  canvas.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-',' '].includes(e.key))return;e.preventDefault();if(e.key==='ArrowLeft')earth.rotation.y-=.12;if(e.key==='ArrowRight')earth.rotation.y+=.12;if(e.key==='ArrowUp')earth.rotation.x=Math.max(-.65,earth.rotation.x-.08);if(e.key==='ArrowDown')earth.rotation.x=Math.min(.65,earth.rotation.x+.08);if(e.key==='+'||e.key==='=')zoomBy(.1);if(e.key==='-')zoomBy(-.1);if(e.key===' ')document.getElementById('pause').click();});
  const intersection=new IntersectionObserver(([e])=>visible=e.isIntersecting);intersection.observe(canvas);
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();failed=true;cancelAnimationFrame(frameId);labels.replaceChildren();onFailure();});
  reduced.addEventListener('change',e=>{paused=e.matches;document.getElementById('pause').setAttribute('aria-pressed',String(paused));});
  render();onReady();
  return {update,zoomBy,pause(value){paused=value;},reset(){earth.rotation.set(.12,.60,-.055);zoom=1;resize();},dispose(){failed=true;cancelAnimationFrame(frameId);observer.disconnect();intersection.disconnect();renderer.dispose();}};
}
