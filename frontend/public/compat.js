/* AI_NovelGenerator 局域网 HTTP 环境兼容补丁
 * 非安全上下文（http:// + 非 localhost）下浏览器会禁用 crypto.subtle 与 crypto.randomUUID，
 * 导致章节检查、版本比对等依赖 SHA-256 的功能报错。
 */
(function () {
  var g = typeof globalThis !== "undefined" ? globalThis : window;
  if (typeof g.crypto === "undefined") {
    try {
      Object.defineProperty(g, "crypto", { configurable: true, value: {} });
    } catch (e) {
      return;
    }
  }
  var cryptoObj = g.crypto;

  var K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);

  function sha256Bytes(bytes) {
    var H = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ]);
    var l = bytes.length;
    var bitLen = l * 8;
    var totalLen = Math.ceil((l + 9) / 64) * 64;
    var buf = new Uint8Array(totalLen);
    buf.set(bytes);
    buf[l] = 0x80;
    var dv = new DataView(buf.buffer);
    dv.setUint32(totalLen - 8, Math.floor(bitLen / 4294967296));
    dv.setUint32(totalLen - 4, bitLen >>> 0);

    var w = new Uint32Array(64);
    for (var i = 0; i < totalLen; i += 64) {
      for (var t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4);
      for (t = 16; t < 64; t++) {
        var x = w[t - 15], y = w[t - 2];
        var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], gg = H[6], h = H[7];
      for (t = 0; t < 64; t++) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var ch = (e & f) ^ (~e & gg);
        var t1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) >>> 0;
        h = gg; gg = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0;
      H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0;
      H[6] = (H[6] + gg) >>> 0; H[7] = (H[7] + h) >>> 0;
    }

    var out = new Uint8Array(32);
    var odv = new DataView(out.buffer);
    for (i = 0; i < 8; i++) odv.setUint32(i * 4, H[i]);
    return out;
  }

  function toBytes(data) {
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (typeof data === "string") return new TextEncoder().encode(data);
    return new Uint8Array(data);
  }

  function normalizeAlgorithm(alg) {
    var name = alg && typeof alg === "object" ? alg.name : alg;
    return String(name || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  if (!cryptoObj.subtle || typeof cryptoObj.subtle.digest !== "function") {
    var subtleImpl = {
      digest: function (algorithm, data) {
        var name = normalizeAlgorithm(algorithm);
        if (name !== "SHA256" && name !== "SHA1") {
          return Promise.reject(new Error("compat polyfill: unsupported algorithm " + algorithm));
        }
        if (name === "SHA1") {
          return Promise.reject(new Error("compat polyfill: SHA-1 is not supported"));
        }
        try {
          var bytes = sha256Bytes(toBytes(data));
          return Promise.resolve(bytes.buffer);
        } catch (err) {
          return Promise.reject(err);
        }
      }
    };
    try {
      Object.defineProperty(cryptoObj, "subtle", {
        configurable: true, enumerable: true, writable: true, value: subtleImpl
      });
    } catch (e1) {
      try {
        var proto = Object.getPrototypeOf(cryptoObj);
        Object.defineProperty(proto, "subtle", {
          configurable: true, enumerable: true, writable: true, value: subtleImpl
        });
      } catch (e2) {}
    }
  }

  if (typeof cryptoObj.randomUUID !== "function") {
    var uuidImpl = function () {
      var bytes = new Uint8Array(16);
      var filled = false;
      try {
        if (typeof cryptoObj.getRandomValues === "function") {
          cryptoObj.getRandomValues(bytes);
          filled = true;
        }
      } catch (e) {}
      if (!filled) {
        for (var i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
      }
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      var hex = [];
      for (var j = 0; j < 16; j++) hex.push(bytes[j].toString(16).padStart(2, "0"));
      return hex.slice(0, 4).join("") + "-" + hex.slice(4, 6).join("") + "-" +
        hex.slice(6, 8).join("") + "-" + hex.slice(8, 10).join("") + "-" + hex.slice(10, 16).join("");
    };
    try {
      Object.defineProperty(cryptoObj, "randomUUID", {
        configurable: true, enumerable: true, writable: true, value: uuidImpl
      });
    } catch (e3) {
      try {
        Object.getPrototypeOf(cryptoObj).randomUUID = uuidImpl;
      } catch (e4) {}
    }
  }
})();
