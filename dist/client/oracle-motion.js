(() => {
  const host = document.querySelector('.creature');
  const fallback = host.querySelector('img');
  const canvas = document.createElement('canvas');
  canvas.className = 'oracle-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  host.insertBefore(canvas, fallback.nextSibling);
  const gl = canvas.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: false });
  if (!gl) { canvas.remove(); return; }
  const vertexSource = `attribute vec2 position; varying vec2 uv;
    void main(){ uv=vec2(position.x*.5+.5,.5-position.y*.5); gl_Position=vec4(position,0.,1.); }`;
  const fragmentSource = `precision mediump float;
    uniform sampler2D specimen; uniform float time; uniform float interest; uniform vec2 size; uniform vec2 gaze;
    varying vec2 uv;
    vec2 eye(vec2 p,vec2 center){
      vec2 d=(p-center)/vec2(.034,.039);
      float influence=exp(-dot(d,d)*1.8);
      return p-gaze*.008*influence;
    }
    void main(){
      vec2 p=(uv-.5)*size/min(size.x,size.y)+.5;
      p.y+=sin(time*.65)*(.006+interest*.004);
      vec2 root=vec2(.49,.425);
      vec2 d=p-root;
      float radius=length(d);
      float angle=atan(d.y,d.x);
      float arms=smoothstep(.12,.44,radius);
      // Keep the mantle stable; waves grow from the arm roots to their tips.
      float head=1.-smoothstep(.12,.24,length((p-vec2(.63,.215))*vec2(1.,1.1)));
      float strength=arms*(1.-head);
      float armPhase=sin(angle*8.+time*.38);
      float wave=sin(time*1.24+radius*14.+armPhase*1.65);
      float curl=cos(time*.91-angle*8.+radius*17.);
      p+=vec2(-d.y,d.x)*wave*.105*strength*(1.+interest*.22);
      p+=normalize(d+vec2(.001))*curl*.017*strength*(1.+interest*.18);
      p=eye(p,vec2(.419,.303));
      p=eye(p,vec2(.588,.337));
      vec4 tex=texture2D(specimen,clamp(p,0.,1.));
      float light=max(max(tex.r,tex.g),tex.b);
      // Traveling light only illuminates existing translucent neural detail.
      float neural=smoothstep(.30,.85,light)*smoothstep(.01,.17,tex.b-tex.g*.6);
      float impulse=pow(max(0.,sin(radius*34.-time*2.4+angle*.65)),14.);
      tex.rgb+=vec3(.30,.12,.48)*neural*impulse;
      tex.rgb*=1.+.055*sin(time*1.4)+interest*.08;
      float edge=smoothstep(0.,.025,p.x)*smoothstep(0.,.025,p.y)*smoothstep(0.,.025,1.-p.x)*smoothstep(0.,.025,1.-p.y);
      gl_FragColor=vec4(tex.rgb,edge);
    }`;
  function compile(type, source) {
    const shader=gl.createShader(type); gl.shaderSource(shader,source); gl.compileShader(shader);
    if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw new Error('Motion shader unavailable');
    return shader;
  }
  let program;
  try {
    program=gl.createProgram();
    gl.attachShader(program,compile(gl.VERTEX_SHADER,vertexSource));
    gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragmentSource));
    gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error('Motion unavailable');
  } catch { canvas.remove(); return; }
  gl.useProgram(program);
  const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
  const position=gl.getAttribLocation(program,'position');
  gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
  const uniforms={time:gl.getUniformLocation(program,'time'),interest:gl.getUniformLocation(program,'interest'),size:gl.getUniformLocation(program,'size'),gaze:gl.getUniformLocation(program,'gaze')};
  const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  let ready=false, visible=true, frame=0, last=0, elapsed=0;
  let target=[0,0], look=[0,0], pointing=false, interest=0, targetInterest=0, reactionTimer=0;
  function resize(){const rect=canvas.getBoundingClientRect(),ratio=Math.min(devicePixelRatio||1,1.75);canvas.width=Math.round(rect.width*ratio);canvas.height=Math.round(rect.height*ratio);gl.viewport(0,0,canvas.width,canvas.height);gl.uniform2f(uniforms.size,canvas.width,canvas.height);if(ready)draw();}
  function draw(){gl.uniform1f(uniforms.time,elapsed);gl.uniform1f(uniforms.interest,interest);gl.uniform2f(uniforms.gaze,look[0],look[1]);gl.drawArrays(gl.TRIANGLES,0,6);}
  function animate(now){frame=0;if(!ready||!visible||document.hidden)return;
    if(now-last>=32){const dt=Math.min((now-last)/1000,.05);elapsed+=dt;last=now;
      if(!pointing)target=[Math.sin(elapsed*.57)*.65,Math.sin(elapsed*.39)*.5];
      look=look.map((n,i)=>n+(target[i]-n)*.08);interest+=(targetInterest-interest)*.08;draw();
    }frame=requestAnimationFrame(animate);
  }
  function sync(){cancelAnimationFrame(frame);frame=0;last=performance.now();if(ready&&visible&&!document.hidden)frame=requestAnimationFrame(animate);}
  const neural=host.querySelector('.neural-field'),reaction=host.querySelector('.octo-reaction');
  host.addEventListener('pointerenter',()=>{pointing=true;targetInterest=.72;host.classList.add('curious');reaction.textContent='CURIOUS MODE';});
  host.addEventListener('pointermove',e=>{const r=host.getBoundingClientRect(),x=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y=Math.max(0,Math.min(1,(e.clientY-r.top)/r.height));target=[x*2-1,y*2-1];neural.style.setProperty('--cursor-x',x*100+'%');neural.style.setProperty('--cursor-y',y*100+'%');});
  host.addEventListener('pointerdown',e=>{if(e.target.closest('.node'))return;clearTimeout(reactionTimer);targetInterest=1.65;host.classList.add('booped');reaction.textContent='BOOP DETECTED';reactionTimer=setTimeout(()=>{host.classList.remove('booped');reaction.textContent='CURIOUS MODE';targetInterest=pointing?.72:0},620);});
  host.addEventListener('pointerleave',()=>{pointing=false;targetInterest=0;host.classList.remove('curious','booped');reaction.textContent='CURIOUS MODE';});
  document.addEventListener('visibilitychange',sync);
  new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;sync();}).observe(host);
  new ResizeObserver(resize).observe(host);
  const source=new Image();
  source.onload=()=>{gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);ready=true;resize();fallback.style.opacity='0';host.classList.add('motion-ready');sync();};
  source.onerror=()=>{canvas.remove();};
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();ready=false;cancelAnimationFrame(frame);fallback.style.opacity='.92';canvas.style.display='none';});
  source.src=fallback.src;
})();
