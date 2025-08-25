/*
  Whisper SpeechRecognition Shim
  - Replaces window.SpeechRecognition / window.webkitSpeechRecognition
  - Runs fully offline using whisper.cpp (WASM) when available
  - Falls back to existing enhanced offline simulation if whisper fails

  Expected app usage (unchanged):
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognizer = new SpeechRecognition();
    recognizer.continuous = true;
    recognizer.interimResults = false;
    recognizer.lang = "en-US";
    recognizer.onresult = (event) => { ... };
    recognizer.start();
*/

(function () {
  // Preserve native recognizer for fallback
  const NativeRecognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  const WHISPER_BASE = "/whisper";
  const WHISPER_MAIN_JS = `${WHISPER_BASE}/main.js`;
  const WHISPER_WASM = `${WHISPER_BASE}/stream.wasm`;
  const WHISPER_HELPERS = `${WHISPER_BASE}/helpers.js`;
  // Use standard tiny.en model (75MB) for reliability
  const WHISPER_MODEL = `${WHISPER_BASE}/ggml-tiny.en.bin`;

  // Attempt to ensure crossOriginIsolated (required for WASM threads)
  // Uses the COOP/COEP shim service worker if not already isolated
  async function ensureCOI() {
    try {
      if (self.crossOriginIsolated) return true;
      if (!('serviceWorker' in navigator)) return false;
      // Register COI service worker scoped to /whisper/ (does not replace app SW)
      const url = `${WHISPER_BASE}/coi-serviceworker.js`;
      const reg = await navigator.serviceWorker.register(url, { scope: WHISPER_BASE + '/' });
      if (reg.active) return true;
      await new Promise(res => setTimeout(res, 150));
      return self.crossOriginIsolated || !!reg.active;
    } catch (e) {
      console.warn('COI setup failed, continuing without threads:', e);
      return false;
    }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = (e) => reject(e);
      document.head.appendChild(s);
    });
  }

  // Minimal wrapper that mimics Web Speech API shape
  class WhisperSpeechRecognition {
    constructor() {
      this.continuous = true;
      this.interimResults = false;
      this.lang = 'en-US';
      this.onresult = null;
      this.onstart = null;
      this.onend = null;
      this.onerror = null;

      this._ready = false;
      this._listening = false;
      this._audioCtx = null;
      this._mediaStream = null;
      this._processor = null;
      this._queue = [];
      this._moduleLoaded = false;
      this._module = null;
      this._usingFallback = false;
      this._fallbackShim = null;
      this._stdoutBuffer = [];
    }

    async _initWhisper() {
      if (this._moduleLoaded) return true;
      await ensureCOI();
      try {
        // Load helpers first (optional; used by upstream demo, safe to include)
        try { await loadScript(WHISPER_HELPERS); } catch {}

        // Ensure model is available in MEMFS
        if (!this._modelData) {
          console.log('Whisper: fetching model for offline use:', WHISPER_MODEL);
          const resp = await fetch(WHISPER_MODEL, { cache: 'force-cache' });
          if (!resp.ok) throw new Error('model fetch failed: ' + resp.status);
          this._modelData = await resp.arrayBuffer();
          console.log('Whisper: model fetched, size bytes =', this._modelData.byteLength);
        }

        // Configure Module for Emscripten
        const selfRef = this;
        const Module = {
          locateFile(path) {
            if (path.endsWith('.wasm')) return WHISPER_WASM;
            return `${WHISPER_BASE}/${path}`;
          },
          print: (text) => {
            try {
              if (typeof text === 'string') selfRef._handleWhisperOutput(text);
            } catch (e) {
              console.warn('Whisper print handler error:', e);
            }
          },
          printErr: (text) => console.warn(text),
          // Attempt to run stream example with model packaged into MEMFS
          arguments: ['-m', '/models/ggml-tiny.en.bin', '-su', '0', '-tg', '2', '-ml', '1'],
          preRun: [ function () {
            try {
              Module.FS_createPath('/', 'models', true, true);
              if (selfRef._modelData) {
                Module.FS_createDataFile('/models', 'ggml-tiny.en.bin', new Uint8Array(selfRef._modelData), true, false);
              }
            } catch (e) {
              console.warn('Whisper preRun FS error:', e);
            }
          } ]
        };
        // Expose globally for main.js
        window.Module = Module;
        await loadScript(WHISPER_MAIN_JS);
        // Module will run main() automatically in many builds. If not, it will still init runtime.
        this._module = Module;
        this._moduleLoaded = true;
        return true;
      } catch (e) {
        console.warn('Failed to initialize whisper wasm:', e);
        return false;
      }
    }

    _handleWhisperOutput(line) {
      const trimmed = String(line || '').trim();
      if (!trimmed) return;
      // Heuristic: forward any printed non-empty line as a final transcript chunk
      // to the app using the SpeechRecognition onresult shape
      if (this.onresult) {
        try {
          const transcript = trimmed.toLowerCase();
          const event = {
            results: [{ 0: { transcript, confidence: 0.75 }, length: 1 }],
            resultIndex: 0
          };
          this.onresult(event);
        } catch (e) {
          console.warn('onresult handler error:', e);
        }
      }
    }

    async start() {
      if (this._listening) return;
      // Try whisper init; if fails, fall back
      const ok = await this._initWhisper();
      if (!ok) {
        // Prefer native speech recognition if available
        if (NativeRecognition) {
          try {
            const shim = new NativeRecognition();
            shim.continuous = this.continuous;
            shim.interimResults = this.interimResults;
            shim.lang = this.lang;
            shim.onresult = (e) => this.onresult && this.onresult(e);
            shim.onerror = (e) => this.onerror && this.onerror(e);
            shim.onend = () => this.onend && this.onend();
            this._usingFallback = true;
            this._fallbackShim = shim;
            this._listening = true;
            this.onstart && this.onstart();
            // Beep on start
            try { const b = document.getElementById('voiceBeep'); b && b.play && b.play(); } catch {}
            shim.start();
            return;
          } catch (e) {
            console.warn('Native SpeechRecognition fallback unavailable:', e);
          }
        }
        // Else try offline simulation if present
        const OfflineCtor = (window.enhancedOfflineVoice && function(){ return window.enhancedOfflineVoice.recognition; }) ||
                            (window.offlineVoice && function(){ return window.offlineVoice.recognition; });
        if (OfflineCtor) {
          try {
            const shim = OfflineCtor();
            shim.onresult = (e) => this.onresult && this.onresult(e);
            shim.onerror = (e) => this.onerror && this.onerror(e);
            shim.onend = () => this.onend && this.onend();
            this._usingFallback = true;
            this._fallbackShim = shim;
            this._listening = true;
            this.onstart && this.onstart();
            try { const b = document.getElementById('voiceBeep'); b && b.play && b.play(); } catch {}
            shim.start();
            return;
          } catch (e) {
            console.warn('Offline shim fallback unavailable:', e);
          }
        }
      }

      try {
        this._audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        this._mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, noiseSuppression: true, echoCancellation: true }, video: false });
        const source = this._audioCtx.createMediaStreamSource(this._mediaStream);
        // Use ScriptProcessor as broadly supported fallback
        const bufferSize = 4096;
        this._processor = this._audioCtx.createScriptProcessor(bufferSize, 1, 1);
        source.connect(this._processor);
        this._processor.connect(this._audioCtx.destination);

        this._processor.onaudioprocess = (e) => {
          // Keep the mic and context alive; actual PCM ingestion is handled by the wasm program (stdout parsing)
          // If future integration hooks are added, feed e.inputBuffer.getChannelData(0) to wasm here.
        };

        this._listening = true;
        if (this.onstart) this.onstart();
        // Beep when mic is live
        try { const b = document.getElementById('voiceBeep'); b && b.play && b.play(); } catch {}
      } catch (err) {
        this._listening = false;
        if (this.onerror) this.onerror({ error: err && err.message ? err.message : 'mic-initialization-failed' });
      }
    }

    stop() {
      try {
        if (this._usingFallback && this._fallbackShim) {
          try { this._fallbackShim.stop && this._fallbackShim.stop(); } catch {}
        }
        if (this._processor) {
          this._processor.disconnect();
          this._processor.onaudioprocess = null;
          this._processor = null;
        }
        if (this._audioCtx) {
          try { this._audioCtx.close(); } catch {}
          this._audioCtx = null;
        }
        if (this._mediaStream) {
          for (const tr of this._mediaStream.getTracks ? this._mediaStream.getTracks() : []) {
            try { tr.stop(); } catch {}
          }
          this._mediaStream = null;
        }
      } catch (e) {
        console.warn('stop error:', e);
      } finally {
        this._listening = false;
        if (this.onend) this.onend();
      }
    }

    abort() {
      this.stop();
    }
  }

  // Install shim
  try {
    window.SpeechRecognition = WhisperSpeechRecognition;
    window.webkitSpeechRecognition = WhisperSpeechRecognition;
    console.log('🎤 Whisper SpeechRecognition shim installed');
  } catch (e) {
    console.warn('Failed to install Whisper SpeechRecognition shim:', e);
  }
})();

