import{D,am as fe,ab as ge,ac as me,l as F,M as w,c as pe,an as $,a9 as j,ao as K,E as g,P as B,ap as S,ae as _e,b as A,B as P,t as q,z as xe,G as ve,a4 as ye,a3 as be,v as Q,S as z,n as Se,o as Pe,p as we,s as Ce,ag as Te,ah as Ue,ai as Me,ak as Re,al as Be,aq as Ge,ar as De,as as Fe,at as G,au as Ae,_ as ze,av as V,m as J,R as Ve,w as E,I as H,aw as Ee,L as He,e as v}from"./index-C8OzD_r4.js";const W="http://www.w3.org/2000/svg",L="http://www.w3.org/1999/xhtml";class Z{constructor(){this.svgRoot=document.createElementNS(W,"svg"),this.foreignObject=document.createElementNS(W,"foreignObject"),this.domElement=document.createElementNS(L,"div"),this.styleElement=document.createElementNS(L,"style");const{foreignObject:e,svgRoot:t,styleElement:r,domElement:i}=this;e.setAttribute("width","10000"),e.setAttribute("height","10000"),e.style.overflow="hidden",t.appendChild(e),e.appendChild(r),e.appendChild(i),this.image=D.get().createImage()}destroy(){this.svgRoot.remove(),this.foreignObject.remove(),this.styleElement.remove(),this.domElement.remove(),this.image.src="",this.image.remove(),this.svgRoot=null,this.foreignObject=null,this.styleElement=null,this.domElement=null,this.image=null,this.canvasAndContext=null}}let O;function We(n,e,t,r){r||(r=O||(O=new Z));const{domElement:i,styleElement:a,svgRoot:s}=r;i.innerHTML=`<style>${e.cssStyle};</style><div style='padding:0'>${n}</div>`,i.setAttribute("style","transform-origin: top left; display: inline-block"),t&&(a.textContent=t),document.body.appendChild(s);const o=i.getBoundingClientRect();s.remove();const u=e.padding*2;return{width:o.width-u,height:o.height-u}}const ee=class te extends fe{constructor(...e){super({});let t=e[0]??{};typeof t=="number"&&(ge(me,"PlaneGeometry constructor changed please use { width, height, verticesX, verticesY } instead"),t={width:t,height:e[1],verticesX:e[2],verticesY:e[3]}),this.build(t)}build(e){e={...te.defaultOptions,...e},this.verticesX=this.verticesX??e.verticesX,this.verticesY=this.verticesY??e.verticesY,this.width=this.width??e.width,this.height=this.height??e.height;const t=this.verticesX*this.verticesY,r=[],i=[],a=[],s=this.verticesX-1,o=this.verticesY-1,u=this.width/s,c=this.height/o;for(let d=0;d<t;d++){const l=d%this.verticesX,f=d/this.verticesX|0;r.push(l*u,f*c),i.push(l/s,f/o)}const h=s*o;for(let d=0;d<h;d++){const l=d%s,f=d/s|0,_=f*this.verticesX+l,p=f*this.verticesX+l+1,m=(f+1)*this.verticesX+l,x=(f+1)*this.verticesX+l+1;a.push(_,p,m,p,x,m)}this.buffers[0].data=new Float32Array(r),this.buffers[1].data=new Float32Array(i),this.indexBuffer.data=new Uint32Array(a),this.buffers[0].update(),this.buffers[1].update(),this.indexBuffer.update()}};ee.defaultOptions={width:100,height:100,verticesX:10,verticesY:10};let Le=ee;class X{destroy(){}}class re{constructor(e,t){this.localUniforms=new F({uTransformMatrix:{value:new w,type:"mat3x3<f32>"},uColor:{value:new Float32Array([1,1,1,1]),type:"vec4<f32>"},uRound:{value:0,type:"f32"}}),this.localUniformsBindGroup=new pe({0:this.localUniforms}),this.renderer=e,this._adaptor=t,this._adaptor.init()}validateRenderable(e){const t=this._getMeshData(e),r=t.batched,i=e.batched;if(t.batched=i,r!==i)return!0;if(i){const a=e._geometry;if(a.indices.length!==t.indexSize||a.positions.length!==t.vertexSize)return t.indexSize=a.indices.length,t.vertexSize=a.positions.length,!0;const s=this._getBatchableMesh(e);return s.texture.uid!==e._texture.uid&&(s._textureMatrixUpdateId=-1),!s._batcher.checkAndUpdateTexture(s,e._texture)}return!1}addRenderable(e,t){const r=this.renderer.renderPipes.batch,i=this._getMeshData(e);if(e.didViewUpdate&&(i.indexSize=e._geometry.indices?.length,i.vertexSize=e._geometry.positions?.length),i.batched){const a=this._getBatchableMesh(e);a.setTexture(e._texture),a.geometry=e._geometry,r.addToBatch(a,t)}else r.break(t),t.add(e)}updateRenderable(e){if(e.batched){const t=this._getBatchableMesh(e);t.setTexture(e._texture),t.geometry=e._geometry,t._batcher.updateElement(t)}}execute(e){if(!e.isRenderable)return;e.state.blendMode=$(e.groupBlendMode,e.texture._source);const t=this.localUniforms;t.uniforms.uTransformMatrix=e.groupTransform,t.uniforms.uRound=this.renderer._roundPixels|e._roundPixels,t.update(),j(e.groupColorAlpha,t.uniforms.uColor,0),this._adaptor.execute(this,e)}_getMeshData(e){var t,r;return(t=e._gpuData)[r=this.renderer.uid]||(t[r]=new X),e._gpuData[this.renderer.uid].meshData||this._initMeshData(e)}_initMeshData(e){return e._gpuData[this.renderer.uid].meshData={batched:e.batched,indexSize:0,vertexSize:0},e._gpuData[this.renderer.uid].meshData}_getBatchableMesh(e){var t,r;return(t=e._gpuData)[r=this.renderer.uid]||(t[r]=new X),e._gpuData[this.renderer.uid].batchableMesh||this._initBatchableMesh(e)}_initBatchableMesh(e){const t=new K;return t.renderable=e,t.setTexture(e._texture),t.transform=e.groupTransform,t.roundPixels=this.renderer._roundPixels|e._roundPixels,e._gpuData[this.renderer.uid].batchableMesh=t,t}destroy(){this.localUniforms=null,this.localUniformsBindGroup=null,this._adaptor.destroy(),this._adaptor=null,this.renderer=null}}re.extension={type:[g.WebGLPipes,g.WebGPUPipes,g.CanvasPipes],name:"mesh"};class Oe{execute(e,t){const r=e.state,i=e.renderer,a=t.shader||e.defaultShader;a.resources.uTexture=t.texture._source,a.resources.uniforms=e.localUniforms;const s=i.gl,o=e.getBuffers(t);i.shader.bind(a),i.state.set(r),i.geometry.bind(o.geometry,a.glProgram);const c=o.geometry.indexBuffer.data.BYTES_PER_ELEMENT===2?s.UNSIGNED_SHORT:s.UNSIGNED_INT;s.drawElements(s.TRIANGLES,t.particleChildren.length*6,c,0)}}class Xe{execute(e,t){const r=e.renderer,i=t.shader||e.defaultShader;i.groups[0]=r.renderPipes.uniformBatch.getUniformBindGroup(e.localUniforms,!0),i.groups[1]=r.texture.getTextureBindGroup(t.texture);const a=e.state,s=e.getBuffers(t);r.encoder.draw({geometry:s.geometry,shader:t.shader||e.defaultShader,state:a,size:t.particleChildren.length*6})}}function Y(n,e=null){const t=n*6;if(t>65535?e||(e=new Uint32Array(t)):e||(e=new Uint16Array(t)),e.length!==t)throw new Error(`Out buffer length is incorrect, got ${e.length} and expected ${t}`);for(let r=0,i=0;r<t;r+=6,i+=4)e[r+0]=i+0,e[r+1]=i+1,e[r+2]=i+2,e[r+3]=i+0,e[r+4]=i+2,e[r+5]=i+3;return e}function Ye(n){return{dynamicUpdate:k(n,!0),staticUpdate:k(n,!1)}}function k(n,e){const t=[];t.push(`

        var index = 0;

        for (let i = 0; i < ps.length; ++i)
        {
            const p = ps[i];

            `);let r=0;for(const a in n){const s=n[a];if(e!==s.dynamic)continue;t.push(`offset = index + ${r}`),t.push(s.code);const o=B(s.format);r+=o.stride/4}t.push(`
            index += stride * 4;
        }
    `),t.unshift(`
        var stride = ${r};
    `);const i=t.join(`
`);return new Function("ps","f32v","u32v",i)}class ke{constructor(e){this._size=0,this._generateParticleUpdateCache={};const t=this._size=e.size??1e3,r=e.properties;let i=0,a=0;for(const h in r){const d=r[h],l=B(d.format);d.dynamic?a+=l.stride:i+=l.stride}this._dynamicStride=a/4,this._staticStride=i/4,this.staticAttributeBuffer=new S(t*4*i),this.dynamicAttributeBuffer=new S(t*4*a),this.indexBuffer=Y(t);const s=new _e;let o=0,u=0;this._staticBuffer=new A({data:new Float32Array(1),label:"static-particle-buffer",shrinkToFit:!1,usage:P.VERTEX|P.COPY_DST}),this._dynamicBuffer=new A({data:new Float32Array(1),label:"dynamic-particle-buffer",shrinkToFit:!1,usage:P.VERTEX|P.COPY_DST});for(const h in r){const d=r[h],l=B(d.format);d.dynamic?(s.addAttribute(d.attributeName,{buffer:this._dynamicBuffer,stride:this._dynamicStride*4,offset:o*4,format:d.format}),o+=l.size):(s.addAttribute(d.attributeName,{buffer:this._staticBuffer,stride:this._staticStride*4,offset:u*4,format:d.format}),u+=l.size)}s.addIndex(this.indexBuffer);const c=this.getParticleUpdate(r);this._dynamicUpload=c.dynamicUpdate,this._staticUpload=c.staticUpdate,this.geometry=s}getParticleUpdate(e){const t=Ie(e);return this._generateParticleUpdateCache[t]?this._generateParticleUpdateCache[t]:(this._generateParticleUpdateCache[t]=this.generateParticleUpdate(e),this._generateParticleUpdateCache[t])}generateParticleUpdate(e){return Ye(e)}update(e,t){e.length>this._size&&(t=!0,this._size=Math.max(e.length,this._size*1.5|0),this.staticAttributeBuffer=new S(this._size*this._staticStride*4*4),this.dynamicAttributeBuffer=new S(this._size*this._dynamicStride*4*4),this.indexBuffer=Y(this._size),this.geometry.indexBuffer.setDataWithSize(this.indexBuffer,this.indexBuffer.byteLength,!0));const r=this.dynamicAttributeBuffer;if(this._dynamicUpload(e,r.float32View,r.uint32View),this._dynamicBuffer.setDataWithSize(this.dynamicAttributeBuffer.float32View,e.length*this._dynamicStride*4,!0),t){const i=this.staticAttributeBuffer;this._staticUpload(e,i.float32View,i.uint32View),this._staticBuffer.setDataWithSize(i.float32View,e.length*this._staticStride*4,!0)}}destroy(){this._staticBuffer.destroy(),this._dynamicBuffer.destroy(),this.geometry.destroy()}}function Ie(n){const e=[];for(const t in n){const r=n[t];e.push(t,r.code,r.dynamic?"d":"s")}return e.join("_")}var Ne=`varying vec2 vUV;
varying vec4 vColor;

uniform sampler2D uTexture;

void main(void){
    vec4 color = texture2D(uTexture, vUV) * vColor;
    gl_FragColor = color;
}`,$e=`attribute vec2 aVertex;
attribute vec2 aUV;
attribute vec4 aColor;

attribute vec2 aPosition;
attribute float aRotation;

uniform mat3 uTranslationMatrix;
uniform float uRound;
uniform vec2 uResolution;
uniform vec4 uColor;

varying vec2 vUV;
varying vec4 vColor;

vec2 roundPixels(vec2 position, vec2 targetSize)
{       
    return (floor(((position * 0.5 + 0.5) * targetSize) + 0.5) / targetSize) * 2.0 - 1.0;
}

void main(void){
    float cosRotation = cos(aRotation);
    float sinRotation = sin(aRotation);
    float x = aVertex.x * cosRotation - aVertex.y * sinRotation;
    float y = aVertex.x * sinRotation + aVertex.y * cosRotation;

    vec2 v = vec2(x, y);
    v = v + aPosition;

    gl_Position = vec4((uTranslationMatrix * vec3(v, 1.0)).xy, 0.0, 1.0);

    if(uRound == 1.0)
    {
        gl_Position.xy = roundPixels(gl_Position.xy, uResolution);
    }

    vUV = aUV;
    vColor = vec4(aColor.rgb * aColor.a, aColor.a) * uColor;
}
`,I=`
struct ParticleUniforms {
  uTranslationMatrix:mat3x3<f32>,
  uColor:vec4<f32>,
  uRound:f32,
  uResolution:vec2<f32>,
};

fn roundPixels(position: vec2<f32>, targetSize: vec2<f32>) -> vec2<f32>
{
  return (floor(((position * 0.5 + 0.5) * targetSize) + 0.5) / targetSize) * 2.0 - 1.0;
}

@group(0) @binding(0) var<uniform> uniforms: ParticleUniforms;

@group(1) @binding(0) var uTexture: texture_2d<f32>;
@group(1) @binding(1) var uSampler : sampler;

struct VSOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv : vec2<f32>,
    @location(1) color : vec4<f32>,
  };
@vertex
fn mainVertex(
  @location(0) aVertex: vec2<f32>,
  @location(1) aPosition: vec2<f32>,
  @location(2) aUV: vec2<f32>,
  @location(3) aColor: vec4<f32>,
  @location(4) aRotation: f32,
) -> VSOutput {
  
   let v = vec2(
       aVertex.x * cos(aRotation) - aVertex.y * sin(aRotation),
       aVertex.x * sin(aRotation) + aVertex.y * cos(aRotation)
   ) + aPosition;

   var position = vec4((uniforms.uTranslationMatrix * vec3(v, 1.0)).xy, 0.0, 1.0);

   if(uniforms.uRound == 1.0) {
       position = vec4(roundPixels(position.xy, uniforms.uResolution), position.zw);
   }

    let vColor = vec4(aColor.rgb * aColor.a, aColor.a) * uniforms.uColor;

  return VSOutput(
   position,
   aUV,
   vColor,
  );
}

@fragment
fn mainFragment(
  @location(0) uv: vec2<f32>,
  @location(1) color: vec4<f32>,
  @builtin(position) position: vec4<f32>,
) -> @location(0) vec4<f32> {

    var sample = textureSample(uTexture, uSampler, uv) * color;
   
    return sample;
}`;class je extends q{constructor(){const e=xe.from({vertex:$e,fragment:Ne}),t=ve.from({fragment:{source:I,entryPoint:"mainFragment"},vertex:{source:I,entryPoint:"mainVertex"}});super({glProgram:e,gpuProgram:t,resources:{uTexture:Q.WHITE.source,uSampler:new be({}),uniforms:{uTranslationMatrix:{value:new w,type:"mat3x3<f32>"},uColor:{value:new ye(16777215),type:"vec4<f32>"},uRound:{value:1,type:"f32"},uResolution:{value:[0,0],type:"vec2<f32>"}}}})}}class ie{constructor(e,t){this.state=z.for2d(),this.localUniforms=new F({uTranslationMatrix:{value:new w,type:"mat3x3<f32>"},uColor:{value:new Float32Array(4),type:"vec4<f32>"},uRound:{value:1,type:"f32"},uResolution:{value:[0,0],type:"vec2<f32>"}}),this.renderer=e,this.adaptor=t,this.defaultShader=new je,this.state=z.for2d()}validateRenderable(e){return!1}addRenderable(e,t){this.renderer.renderPipes.batch.break(t),t.add(e)}getBuffers(e){return e._gpuData[this.renderer.uid]||this._initBuffer(e)}_initBuffer(e){return e._gpuData[this.renderer.uid]=new ke({size:e.particleChildren.length,properties:e._properties}),e._gpuData[this.renderer.uid]}updateRenderable(e){}execute(e){const t=e.particleChildren;if(t.length===0)return;const r=this.renderer,i=this.getBuffers(e);e.texture||(e.texture=t[0].texture);const a=this.state;i.update(t,e._childrenDirty),e._childrenDirty=!1,a.blendMode=$(e.blendMode,e.texture._source);const s=this.localUniforms.uniforms,o=s.uTranslationMatrix;e.worldTransform.copyTo(o),o.prepend(r.globalUniforms.globalUniformData.projectionMatrix),s.uResolution=r.globalUniforms.globalUniformData.resolution,s.uRound=r._roundPixels|e._roundPixels,j(e.groupColorAlpha,s.uColor,0),this.adaptor.execute(this,e)}destroy(){this.renderer=null,this.defaultShader&&(this.defaultShader.destroy(),this.defaultShader=null)}}class ne extends ie{constructor(e){super(e,new Oe)}}ne.extension={type:[g.WebGLPipes],name:"particle"};class se extends ie{constructor(e){super(e,new Xe)}}se.extension={type:[g.WebGPUPipes],name:"particle"};const ae=class oe extends Le{constructor(e={}){e={...oe.defaultOptions,...e},super({width:e.width,height:e.height,verticesX:4,verticesY:4}),this.update(e)}update(e){this.width=e.width??this.width,this.height=e.height??this.height,this._originalWidth=e.originalWidth??this._originalWidth,this._originalHeight=e.originalHeight??this._originalHeight,this._leftWidth=e.leftWidth??this._leftWidth,this._rightWidth=e.rightWidth??this._rightWidth,this._topHeight=e.topHeight??this._topHeight,this._bottomHeight=e.bottomHeight??this._bottomHeight,this._anchorX=e.anchor?.x,this._anchorY=e.anchor?.y,this.updateUvs(),this.updatePositions()}updatePositions(){const e=this.positions,{width:t,height:r,_leftWidth:i,_rightWidth:a,_topHeight:s,_bottomHeight:o,_anchorX:u,_anchorY:c}=this,h=i+a,d=t>h?1:t/h,l=s+o,f=r>l?1:r/l,_=Math.min(d,f),p=u*t,m=c*r;e[0]=e[8]=e[16]=e[24]=-p,e[2]=e[10]=e[18]=e[26]=i*_-p,e[4]=e[12]=e[20]=e[28]=t-a*_-p,e[6]=e[14]=e[22]=e[30]=t-p,e[1]=e[3]=e[5]=e[7]=-m,e[9]=e[11]=e[13]=e[15]=s*_-m,e[17]=e[19]=e[21]=e[23]=r-o*_-m,e[25]=e[27]=e[29]=e[31]=r-m,this.getBuffer("aPosition").update()}updateUvs(){const e=this.uvs;e[0]=e[8]=e[16]=e[24]=0,e[1]=e[3]=e[5]=e[7]=0,e[6]=e[14]=e[22]=e[30]=1,e[25]=e[27]=e[29]=e[31]=1;const t=1/this._originalWidth,r=1/this._originalHeight;e[2]=e[10]=e[18]=e[26]=t*this._leftWidth,e[9]=e[11]=e[13]=e[15]=r*this._topHeight,e[4]=e[12]=e[20]=e[28]=1-t*this._rightWidth,e[17]=e[19]=e[21]=e[23]=1-r*this._bottomHeight,this.getBuffer("aUV").update()}};ae.defaultOptions={width:100,height:100,leftWidth:10,topHeight:10,rightWidth:10,bottomHeight:10,originalWidth:100,originalHeight:100};let Ke=ae;class qe extends K{constructor(){super(),this.geometry=new Ke}destroy(){this.geometry.destroy()}}class ue{constructor(e){this._renderer=e}addRenderable(e,t){const r=this._getGpuSprite(e);e.didViewUpdate&&this._updateBatchableSprite(e,r),this._renderer.renderPipes.batch.addToBatch(r,t)}updateRenderable(e){const t=this._getGpuSprite(e);e.didViewUpdate&&this._updateBatchableSprite(e,t),t._batcher.updateElement(t)}validateRenderable(e){const t=this._getGpuSprite(e);return!t._batcher.checkAndUpdateTexture(t,e._texture)}_updateBatchableSprite(e,t){t.geometry.update(e),t.setTexture(e._texture)}_getGpuSprite(e){return e._gpuData[this._renderer.uid]||this._initGPUSprite(e)}_initGPUSprite(e){const t=e._gpuData[this._renderer.uid]=new qe,r=t;return r.renderable=e,r.transform=e.groupTransform,r.texture=e._texture,r.roundPixels=this._renderer._roundPixels|e._roundPixels,e.didViewUpdate||this._updateBatchableSprite(e,r),t}destroy(){this._renderer=null}}ue.extension={type:[g.WebGLPipes,g.WebGPUPipes,g.CanvasPipes],name:"nineSliceSprite"};const Qe={name:"local-uniform-msdf-bit",vertex:{header:`
            struct LocalUniforms {
                uColor:vec4<f32>,
                uTransformMatrix:mat3x3<f32>,
                uDistance: f32,
                uRound:f32,
            }

            @group(2) @binding(0) var<uniform> localUniforms : LocalUniforms;
        `,main:`
            vColor *= localUniforms.uColor;
            modelMatrix *= localUniforms.uTransformMatrix;
        `,end:`
            if(localUniforms.uRound == 1)
            {
                vPosition = vec4(roundPixels(vPosition.xy, globalUniforms.uResolution), vPosition.zw);
            }
        `},fragment:{header:`
            struct LocalUniforms {
                uColor:vec4<f32>,
                uTransformMatrix:mat3x3<f32>,
                uDistance: f32
            }

            @group(2) @binding(0) var<uniform> localUniforms : LocalUniforms;
         `,main:`
            outColor = vec4<f32>(calculateMSDFAlpha(outColor, localUniforms.uColor, localUniforms.uDistance));
        `}},Je={name:"local-uniform-msdf-bit",vertex:{header:`
            uniform mat3 uTransformMatrix;
            uniform vec4 uColor;
            uniform float uRound;
        `,main:`
            vColor *= uColor;
            modelMatrix *= uTransformMatrix;
        `,end:`
            if(uRound == 1.)
            {
                gl_Position.xy = roundPixels(gl_Position.xy, uResolution);
            }
        `},fragment:{header:`
            uniform float uDistance;
         `,main:`
            outColor = vec4(calculateMSDFAlpha(outColor, vColor, uDistance));
        `}},Ze={name:"msdf-bit",fragment:{header:`
            fn calculateMSDFAlpha(msdfColor:vec4<f32>, shapeColor:vec4<f32>, distance:f32) -> f32 {

                // MSDF
                var median = msdfColor.r + msdfColor.g + msdfColor.b -
                    min(msdfColor.r, min(msdfColor.g, msdfColor.b)) -
                    max(msdfColor.r, max(msdfColor.g, msdfColor.b));

                // SDF
                median = min(median, msdfColor.a);

                var screenPxDistance = distance * (median - 0.5);
                var alpha = clamp(screenPxDistance + 0.5, 0.0, 1.0);
                if (median < 0.01) {
                    alpha = 0.0;
                } else if (median > 0.99) {
                    alpha = 1.0;
                }

                // Gamma correction for coverage-like alpha
                var luma: f32 = dot(shapeColor.rgb, vec3<f32>(0.299, 0.587, 0.114));
                var gamma: f32 = mix(1.0, 1.0 / 2.2, luma);
                var coverage: f32 = pow(shapeColor.a * alpha, gamma);

                return coverage;

            }
        `}},et={name:"msdf-bit",fragment:{header:`
            float calculateMSDFAlpha(vec4 msdfColor, vec4 shapeColor, float distance) {

                // MSDF
                float median = msdfColor.r + msdfColor.g + msdfColor.b -
                                min(msdfColor.r, min(msdfColor.g, msdfColor.b)) -
                                max(msdfColor.r, max(msdfColor.g, msdfColor.b));

                // SDF
                median = min(median, msdfColor.a);

                float screenPxDistance = distance * (median - 0.5);
                float alpha = clamp(screenPxDistance + 0.5, 0.0, 1.0);

                if (median < 0.01) {
                    alpha = 0.0;
                } else if (median > 0.99) {
                    alpha = 1.0;
                }

                // Gamma correction for coverage-like alpha
                float luma = dot(shapeColor.rgb, vec3(0.299, 0.587, 0.114));
                float gamma = mix(1.0, 1.0 / 2.2, luma);
                float coverage = pow(shapeColor.a * alpha, gamma);

                return coverage;
            }
        `}};let U,M;class tt extends q{constructor(e){const t=new F({uColor:{value:new Float32Array([1,1,1,1]),type:"vec4<f32>"},uTransformMatrix:{value:new w,type:"mat3x3<f32>"},uDistance:{value:4,type:"f32"},uRound:{value:0,type:"f32"}});U??(U=Se({name:"sdf-shader",bits:[Pe,we(e),Qe,Ze,Ce]})),M??(M=Te({name:"sdf-shader",bits:[Ue,Me(e),Je,et,Re]})),super({glProgram:M,gpuProgram:U,resources:{localUniforms:t,batchSamplers:Be(e)}})}}class rt extends Ae{destroy(){this.context.customShader&&this.context.customShader.destroy(),super.destroy()}}class le{constructor(e){this._renderer=e}validateRenderable(e){const t=this._getGpuBitmapText(e);return this._renderer.renderPipes.graphics.validateRenderable(t)}addRenderable(e,t){const r=this._getGpuBitmapText(e);N(e,r),e._didTextUpdate&&(e._didTextUpdate=!1,this._updateContext(e,r)),this._renderer.renderPipes.graphics.addRenderable(r,t),r.context.customShader&&this._updateDistanceField(e)}updateRenderable(e){const t=this._getGpuBitmapText(e);N(e,t),this._renderer.renderPipes.graphics.updateRenderable(t),t.context.customShader&&this._updateDistanceField(e)}_updateContext(e,t){const{context:r}=t,i=Ge.getFont(e.text,e._style);r.clear(),i.distanceField.type!=="none"&&(r.customShader||(r.customShader=new tt(this._renderer.limits.maxBatchableTextures)));const a=De.graphemeSegmenter(e.text),s=e._style;let o=i.baseLineOffset;const u=Fe(a,s,i,!0),c=s.padding,h=u.scale;let d=u.width,l=u.height+u.offsetY;s._stroke&&(d+=s._stroke.width/h,l+=s._stroke.width/h),r.translate(-e._anchor._x*d-c,-e._anchor._y*l-c).scale(h,h);const f=i.applyFillAsTint?s._fill.color:16777215;let _=i.fontMetrics.fontSize,p=i.lineHeight;s.lineHeight&&(_=s.fontSize/h,p=s.lineHeight/h);let m=(p-_)/2;m-i.baseLineOffset<0&&(m=0);for(let x=0;x<u.lines.length;x++){const C=u.lines[x];for(let y=0;y<C.charPositions.length;y++){const he=C.chars[y],b=i.chars[he];if(b?.texture){const T=b.texture;r.texture(T,f||"black",Math.round(C.charPositions[y]+b.xOffset),Math.round(o+b.yOffset+m),T.orig.width,T.orig.height)}}o+=p}}_getGpuBitmapText(e){return e._gpuData[this._renderer.uid]||this.initGpuText(e)}initGpuText(e){const t=new rt;return e._gpuData[this._renderer.uid]=t,this._updateContext(e,t),t}_updateDistanceField(e){const t=this._getGpuBitmapText(e).context,r=e._style.fontFamily,i=G.get(`${r}-bitmap`),{a,b:s,c:o,d:u}=e.groupTransform,c=Math.sqrt(a*a+s*s),h=Math.sqrt(o*o+u*u),d=(Math.abs(c)+Math.abs(h))/2,l=i.baseRenderedFontSize/e._style.fontSize,f=d*i.distanceField.range*(1/l);t.customShader.resources.localUniforms.uniforms.uDistance=f}destroy(){this._renderer=null}}le.extension={type:[g.WebGLPipes,g.WebGPUPipes,g.CanvasPipes],name:"bitmapText"};function N(n,e){e.groupTransform=n.groupTransform,e.groupColorAlpha=n.groupColorAlpha,e.groupColor=n.groupColor,e.groupBlendMode=n.groupBlendMode,e.globalDisplayStatus=n.globalDisplayStatus,e.groupTransform=n.groupTransform,e.localDisplayStatus=n.localDisplayStatus,e.groupAlpha=n.groupAlpha,e._roundPixels=n._roundPixels}class it extends ze{constructor(e){super(),this.generatingTexture=!1,this.currentKey="--",this._renderer=e,e.runners.resolutionChange.add(this)}resolutionChange(){const e=this.renderable;e._autoResolution&&e.onViewUpdate()}destroy(){const{htmlText:e}=this._renderer;e.getReferenceCount(this.currentKey)===null?e.returnTexturePromise(this.texturePromise):e.decreaseReferenceCount(this.currentKey),this._renderer.runners.resolutionChange.remove(this),this.texturePromise=null,this._renderer=null}}class ce{constructor(e){this._renderer=e}validateRenderable(e){const t=this._getGpuText(e),r=e.styleKey;return t.currentKey!==r}addRenderable(e,t){const r=this._getGpuText(e);if(e._didTextUpdate){const i=e._autoResolution?this._renderer.resolution:e.resolution;(r.currentKey!==e.styleKey||e.resolution!==i)&&this._updateGpuText(e).catch(a=>{console.error(a)}),e._didTextUpdate=!1,V(r,e)}this._renderer.renderPipes.batch.addToBatch(r,t)}updateRenderable(e){const t=this._getGpuText(e);t._batcher.updateElement(t)}async _updateGpuText(e){e._didTextUpdate=!1;const t=this._getGpuText(e);if(t.generatingTexture)return;const r=t.texturePromise;t.texturePromise=null,t.generatingTexture=!0,e._resolution=e._autoResolution?this._renderer.resolution:e.resolution;let i=this._renderer.htmlText.getTexturePromise(e);r&&(i=i.finally(()=>{this._renderer.htmlText.decreaseReferenceCount(t.currentKey),this._renderer.htmlText.returnTexturePromise(r)})),t.texturePromise=i,t.currentKey=e.styleKey,t.texture=await i;const a=e.renderGroup||e.parentRenderGroup;a&&(a.structureDidChange=!0),t.generatingTexture=!1,V(t,e)}_getGpuText(e){return e._gpuData[this._renderer.uid]||this.initGpuText(e)}initGpuText(e){const t=new it(this._renderer);return t.renderable=e,t.transform=e.groupTransform,t.texture=Q.EMPTY,t.bounds={minX:0,maxX:1,minY:0,maxY:0},t.roundPixels=this._renderer._roundPixels|e._roundPixels,e._resolution=e._autoResolution?this._renderer.resolution:e.resolution,e._gpuData[this._renderer.uid]=t,t}destroy(){this._renderer=null}}ce.extension={type:[g.WebGLPipes,g.WebGPUPipes,g.CanvasPipes],name:"htmlText"};function nt(){const{userAgent:n}=D.get().getNavigator();return/^((?!chrome|android).)*safari/i.test(n)}function st(n,e){const t=e.fontFamily,r=[],i={},a=/font-family:([^;"\s]+)/g,s=n.match(a);function o(u){i[u]||(r.push(u),i[u]=!0)}if(Array.isArray(t))for(let u=0;u<t.length;u++)o(t[u]);else o(t);s&&s.forEach(u=>{const c=u.split(":")[1].trim();o(c)});for(const u in e.tagStyles){const c=e.tagStyles[u].fontFamily;o(c)}return r}async function at(n){const t=await(await D.get().fetch(n)).blob(),r=new FileReader;return await new Promise((a,s)=>{r.onloadend=()=>a(r.result),r.onerror=s,r.readAsDataURL(t)})}async function ot(n,e){const t=await at(e);return`@font-face {
        font-family: "${n.fontFamily}";
        font-weight: ${n.fontWeight};
        font-style: ${n.fontStyle};
        src: url('${t}');
    }`}const R=new Map;async function ut(n){const e=n.filter(t=>G.has(`${t}-and-url`)).map(t=>{if(!R.has(t)){const{entries:r}=G.get(`${t}-and-url`),i=[];r.forEach(a=>{const s=a.url,u=a.faces.map(c=>({weight:c.weight,style:c.style}));i.push(...u.map(c=>ot({fontWeight:c.weight,fontStyle:c.style,fontFamily:t},s)))}),R.set(t,Promise.all(i).then(a=>a.join(`
`)))}return R.get(t)});return(await Promise.all(e)).join(`
`)}function lt(n,e,t,r,i){const{domElement:a,styleElement:s,svgRoot:o}=i;a.innerHTML=`<style>${e.cssStyle}</style><div style='padding:0;'>${n}</div>`,a.setAttribute("style",`transform: scale(${t});transform-origin: top left; display: inline-block`),s.textContent=r;const{width:u,height:c}=i.image;return o.setAttribute("width",u.toString()),o.setAttribute("height",c.toString()),new XMLSerializer().serializeToString(o)}function ct(n,e){const t=J.getOptimalCanvasAndContext(n.width,n.height,e),{context:r}=t;return r.clearRect(0,0,n.width,n.height),r.drawImage(n,0,0),t}function dt(n,e,t){return new Promise(async r=>{t&&await new Promise(i=>setTimeout(i,100)),n.onload=()=>{r()},n.src=`data:image/svg+xml;charset=utf8,${encodeURIComponent(e)}`,n.crossOrigin="anonymous"})}class de{constructor(e){this._activeTextures={},this._renderer=e,this._createCanvas=e.type===Ve.WEBGPU}getTexture(e){return this.getTexturePromise(e)}getManagedTexture(e){const t=e.styleKey;if(this._activeTextures[t])return this._increaseReferenceCount(t),this._activeTextures[t].promise;const r=this._buildTexturePromise(e).then(i=>(this._activeTextures[t].texture=i,i));return this._activeTextures[t]={texture:null,promise:r,usageCount:1},r}getReferenceCount(e){return this._activeTextures[e]?.usageCount??null}_increaseReferenceCount(e){this._activeTextures[e].usageCount++}decreaseReferenceCount(e){const t=this._activeTextures[e];t&&(t.usageCount--,t.usageCount===0&&(t.texture?this._cleanUp(t.texture):t.promise.then(r=>{t.texture=r,this._cleanUp(t.texture)}).catch(()=>{E("HTMLTextSystem: Failed to clean texture")}),this._activeTextures[e]=null))}getTexturePromise(e){return this._buildTexturePromise(e)}async _buildTexturePromise(e){const{text:t,style:r,resolution:i,textureStyle:a}=e,s=H.get(Z),o=st(t,r),u=await ut(o),c=We(t,r,u,s),h=Math.ceil(Math.ceil(Math.max(1,c.width)+r.padding*2)*i),d=Math.ceil(Math.ceil(Math.max(1,c.height)+r.padding*2)*i),l=s.image,f=2;l.width=(h|0)+f,l.height=(d|0)+f;const _=lt(t,r,i,u,s);await dt(l,_,nt()&&o.length>0);const p=l;let m;this._createCanvas&&(m=ct(l,i));const x=Ee(m?m.canvas:p,l.width-f,l.height-f,i);return a&&(x.source.style=a),this._createCanvas&&(this._renderer.texture.initSource(x.source),J.returnCanvasAndContext(m)),H.return(s),x}returnTexturePromise(e){e.then(t=>{this._cleanUp(t)}).catch(()=>{E("HTMLTextSystem: Failed to clean texture")})}_cleanUp(e){He.returnTexture(e,!0),e.source.resource=null,e.source.uploadMethodId="unknown"}destroy(){this._renderer=null;for(const e in this._activeTextures)this._activeTextures[e]&&this.returnTexturePromise(this._activeTextures[e].promise);this._activeTextures=null}}de.extension={type:[g.WebGLSystem,g.WebGPUSystem,g.CanvasSystem],name:"htmlText"};v.add(re);v.add(ne);v.add(se);v.add(le);v.add(de);v.add(ce);v.add(ue);
//# sourceMappingURL=webworkerAll--r6SLhu_.js.map
