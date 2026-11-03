/* Full-screen effects as one WebGL2 shader, with a feedback buffer for trails.
   Falls back to a plain copy if the machine has no WebGL2. */
(function (YT) {
  'use strict';

  const VERT = `#version 300 es
in vec2 p; out vec2 v;
void main(){ v = p * .5 + .5; gl_Position = vec4(p, 0., 1.); }`;

  const BLIT = `#version 300 es
precision highp float; in vec2 v; out vec4 o; uniform sampler2D T;
void main(){ o = texture(T, v); }`;

  const FRAG = `#version 300 es
precision highp float;
in vec2 v; out vec4 o;
uniform sampler2D T, F;
uniform vec2 R;
uniform float t, rgb, pix, wave, swirl, bulge, glitch, vhs, crt, kal, kalRot, zblur, bloom, sharp, edge;
uniform float fb, fbz, fbr, hue, sat, con, bri, post, inv, duo, dith, vig, scan, grain;
uniform vec2 mir;
uniform vec3 duoA, duoB;

float h1(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 hueRot(vec3 c, float a){
  const vec3 k = vec3(.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1. - ca);
}
const mat4 BAYER = mat4(0.,8.,2.,10., 12.,4.,14.,6., 3.,11.,1.,9., 15.,7.,13.,5.);

void main(){
  vec2 uv = v;
  float asp = R.x / R.y;

  if (crt > 0.) {
    vec2 q = (uv - .5) * 2.;
    q *= 1. + crt * .22 * dot(q, q);
    uv = q * .5 + .5;
  }
  if (bulge != 0.) {
    vec2 q = (uv - .5) * vec2(asp, 1.);
    float r = length(q);
    q *= pow(max(r, 1e-4) * 2., bulge * .8) ;
    uv = q / vec2(asp, 1.) + .5;
  }
  if (swirl != 0.) {
    vec2 q = (uv - .5) * vec2(asp, 1.);
    float r = length(q), a = swirl * 4. * max(0., 1. - r * 1.6);
    float c = cos(a), s = sin(a);
    q = mat2(c, -s, s, c) * q;
    uv = q / vec2(asp, 1.) + .5;
  }
  if (wave > 0.) {
    uv.x += sin(uv.y * 22. + t * 7.) * wave * .05;
    uv.y += sin(uv.x * 15. + t * 5.) * wave * .025;
  }
  if (vhs > 0.) {
    uv.x += vhs * (.0035 * sin(uv.y * 90. + t * 9.) + .005 * sin(uv.y * 7. - t * 2.));
    float band = fract(t * .13);
    if (abs(uv.y - band) < .035) uv.x += vhs * .05 * (h1(vec2(floor(uv.y * 240.), floor(t * 30.))) - .5);
  }
  if (glitch > 0.) {
    float tt = floor(t * 24.), b = floor(uv.y * 16.);
    if (h1(vec2(b, tt)) < glitch) uv.x += (h1(vec2(b + 3., tt)) - .5) * .4 * glitch;
    float bx = floor(uv.x * 12.);
    if (h1(vec2(bx, b + tt)) < glitch * .12) uv.y += (h1(vec2(bx, tt)) - .5) * .25;
  }
  if (kal >= 2.) {
    vec2 q = (uv - .5) * vec2(asp, 1.);
    float r = length(q), a = atan(q.y, q.x) + kalRot, s = 6.2831853 / kal;
    a = mod(a, s);
    a = abs(a - s * .5);
    q = r * vec2(cos(a), sin(a));
    uv = q / vec2(asp, 1.) + .5;
  }
  if (mir.x > .5) uv.x = .5 - abs(uv.x - .5);
  if (mir.y > .5) uv.y = .5 + abs(uv.y - .5);
  if (pix > 1.) {
    vec2 size = pix / R;
    uv = (floor(uv / size) + .5) * size;
  }

  vec2 off = vec2(rgb + vhs * 2.5, 0.) / R;
  vec3 c = vec3(texture(T, uv + off).r, texture(T, uv).g, texture(T, uv - off).b);

  if (zblur > 0.) {
    vec3 sum = c;
    vec2 dir = (.5 - uv) * zblur * .035;
    for (int i = 1; i < 12; i++) sum += texture(T, uv + dir * float(i)).rgb;
    c = sum / 12.;
  }
  if (sharp > 0. || edge > 0.) {
    vec2 px = 1.5 / R;
    vec3 l = texture(T, uv - vec2(px.x, 0.)).rgb, r = texture(T, uv + vec2(px.x, 0.)).rgb;
    vec3 d = texture(T, uv - vec2(0., px.y)).rgb, u = texture(T, uv + vec2(0., px.y)).rgb;
    if (sharp > 0.) c += (c - (l + r + d + u) * .25) * sharp * 2.;
    if (edge > 0.) {
      float mag = length(r - l) + length(u - d);
      c = mix(c, vec3(mag * 1.6), edge);
    }
  }
  if (bloom > 0.) {
    vec3 sum = vec3(0.);
    for (int i = 0; i < 12; i++) {
      float a = float(i) * .5236;
      vec2 d = vec2(cos(a), sin(a));
      sum += max(texture(T, uv + d * 9. / R).rgb - .5, 0.);
      sum += max(texture(T, uv + d * 22. / R).rgb - .5, 0.);
    }
    c += sum / 24. * bloom * 2.2;
  }
  if (fb > 0.) {
    vec2 q = v - .5;
    float cs = cos(fbr), sn = sin(fbr);
    q = mat2(cs, -sn, sn, cs) * q / (1. + fbz);
    c = max(c, texture(F, q + .5).rgb * fb);
  }

  if (hue != 0.) c = hueRot(c, hue);
  float l = dot(c, vec3(.299, .587, .114));
  c = mix(vec3(l), c, sat);
  c = (c - .5) * con + .5;
  c *= bri;
  if (post > 0.) {
    float levels = mix(32., 2., post);
    c = floor(clamp(c, 0., 1.) * levels + .5) / levels;
  }
  c = mix(c, 1. - clamp(c, 0., 1.), inv);
  if (duo > 0.) {
    float k = clamp(dot(c, vec3(.299, .587, .114)), 0., 1.);
    c = mix(c, mix(duoA, duoB, k), duo);
  }
  if (dith > 0.) {
    ivec2 q = ivec2(mod(gl_FragCoord.xy / max(1., pix), 4.));
    float th = (BAYER[q.x][q.y] + .5) / 16.;
    float k = dot(c, vec3(.299, .587, .114));
    c = mix(c, vec3(step(th, k)), dith);
  }
  if (vig > 0.) c *= 1. - vig * smoothstep(.3, .85, length(v - .5) * 1.15);
  if (scan > 0.) c *= 1. - scan * .35 * (.5 + .5 * sin(v.y * R.y * 2.1));
  if (grain > 0.) c += (h1(gl_FragCoord.xy + t * 60.) - .5) * grain * .3;
  o = vec4(c, 1.);
}`;

  class PostFX {
    constructor(canvas) {
      this.canvas = canvas;
      this.gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
      if (!this.gl) {
        this.ctx2d = canvas.getContext('2d', { alpha: false });
        return;
      }
      const gl = this.gl;
      this.main = this._program(VERT, FRAG);
      this.blit = this._program(VERT, BLIT);
      const quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

      this.source = this._texture(gl.MIRRORED_REPEAT);
      this.buffers = [this._target(), this._target()];
      this.uniforms = {};
      const n = gl.getProgramParameter(this.main, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) {
        const name = gl.getActiveUniform(this.main, i).name;
        this.uniforms[name] = gl.getUniformLocation(this.main, name);
      }
      this.w = 0;
      this.h = 0;
      this.fbActive = false;
    }

    _program(vs, fs) {
      const gl = this.gl;
      const compile = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Shader: ${gl.getShaderInfoLog(s)}`);
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(p, 0, 'p');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Program: ${gl.getProgramInfoLog(p)}`);
      return p;
    }

    _texture(wrap) {
      const gl = this.gl, tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      return tex;
    }

    _target() {
      const gl = this.gl;
      return { tex: this._texture(gl.CLAMP_TO_EDGE), fbo: gl.createFramebuffer() };
    }

    resize(w, h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.w = w;
      this.h = h;
      if (!this.gl) return;
      const gl = this.gl;
      for (const b of this.buffers) {
        gl.bindTexture(gl.TEXTURE_2D, b.tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, b.fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, b.tex, 0);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /* Clears trails so a seek or a new export never shows leftovers. */
    reset() {
      if (!this.gl) return;
      const gl = this.gl;
      for (const b of this.buffers) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, b.fbo);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    render(sceneCanvas, fx) {
      if (!this.gl) {
        this.ctx2d.drawImage(sceneCanvas, 0, 0, this.w, this.h);
        return;
      }
      const gl = this.gl, u = this.uniforms;
      gl.bindVertexArray(this.vao);
      gl.useProgram(this.main);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.source);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sceneCanvas);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.uniform1i(u.T, 0);
      gl.uniform2f(u.R, this.w, this.h);
      for (const key of ['t', 'rgb', 'pix', 'wave', 'swirl', 'bulge', 'glitch', 'vhs', 'crt', 'kal', 'kalRot', 'zblur', 'bloom', 'sharp', 'edge', 'fb', 'fbz', 'fbr', 'hue', 'sat', 'con', 'bri', 'post', 'inv', 'duo', 'dith', 'vig', 'scan', 'grain']) {
        if (u[key]) gl.uniform1f(u[key], fx[key] || 0);
      }
      if (u.mir) gl.uniform2f(u.mir, fx.mirX ? 1 : 0, fx.mirY ? 1 : 0);
      if (u.duoA) gl.uniform3fv(u.duoA, fx.duoA || [0, 0, 0]);
      if (u.duoB) gl.uniform3fv(u.duoB, fx.duoB || [1, 1, 1]);
      gl.viewport(0, 0, this.w, this.h);

      if (fx.fb > 0) {
        const [target, previous] = this.buffers;
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, previous.tex);
        gl.uniform1i(u.F, 1);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.useProgram(this.blit);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, target.tex);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        this.buffers = [previous, target];
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        if (u.F) gl.uniform1i(u.F, 1);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    }
  }

  YT.PostFX = PostFX;
})(window.YT);
