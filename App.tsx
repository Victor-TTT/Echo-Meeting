
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Disc, 
  StopCircle, 
  Download, 
  Trash2, 
  BrainCircuit, 
  Monitor, 
  Mic, 
  AlertCircle, 
  FileAudio,
  Play
} from 'lucide-react';
import AudioVisualizer from './components/AudioVisualizer';
import { analyzeAudio } from './services/geminiService';
import { Recording, RecorderState } from './types';

const App: React.FC = () => {
  // State
  const [recorderState, setRecorderState] = useState<RecorderState>(RecorderState.IDLE);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [timer, setTimer] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  const [includeMic, setIncludeMic] = useState(true);

  // Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mixedStreamRef = useRef<MediaStream | null>(null);
  const timerIntervalRef = useRef<number | null>(null);
  
  // Track streams for cleanup
  const activeStreams = useRef<MediaStream[]>([]);

  // Format timer
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const cleanup = () => {
    activeStreams.current.forEach(stream => {
      stream.getTracks().forEach(track => track.stop());
    });
    activeStreams.current = [];
    
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
    }
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
    }
  };

  const startRecording = async () => {
    setErrorMsg(null);
    setRecorderState(RecorderState.PREPARING);
    cleanup();

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioContextClass();
      const destination = audioCtx.createMediaStreamDestination();
      
      let systemStream: MediaStream | null = null;
      let micStream: MediaStream | null = null;

      // 1. Capture System Audio (Teams/Zoom)
      try {
        systemStream = await navigator.mediaDevices.getDisplayMedia({ 
          video: { width: 1, height: 1 }, 
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          } 
        });
        
        if (systemStream.getAudioTracks().length === 0) {
          systemStream.getTracks().forEach(t => t.stop());
          throw new Error("Please check 'Share Audio' in the browser popup to record Teams audio.");
        }
        
        const sysSource = audioCtx.createMediaStreamSource(systemStream);
        sysSource.connect(destination);
        activeStreams.current.push(systemStream);

        systemStream.getVideoTracks()[0].onended = () => stopRecording();
      } catch (e: any) {
        if (e.name === 'NotAllowedError') {
          setRecorderState(RecorderState.IDLE);
          return;
        }
        throw e;
      }

      // 2. Capture Microphone (Bluetooth Mic)
      if (includeMic) {
        try {
          micStream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            } 
          });
          const micSource = audioCtx.createMediaStreamSource(micStream);
          micSource.connect(destination);
          activeStreams.current.push(micStream);
        } catch (e) {
          console.warn("Microphone access denied", e);
        }
      }

      audioContextRef.current = audioCtx;
      mixedStreamRef.current = destination.stream;

      // 3. Setup MediaRecorder with MP4 preference
      const supportedTypes = [
        'audio/mp4',
        'video/mp4;codecs=avc1', 
        'audio/webm;codecs=opus'
      ];
      
      const mimeType = supportedTypes.find(type => MediaRecorder.isTypeSupported(type)) || 'audio/webm';
      const recorder = new MediaRecorder(destination.stream, { 
        mimeType,
        audioBitsPerSecond: 128000
      });

      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        const finalType = recorder.mimeType.includes('mp4') ? 'video/mp4' : 'audio/webm';
        const blob = new Blob(chunks, { type: finalType });
        const extension = finalType.includes('mp4') ? 'mp4' : 'webm';
        const url = URL.createObjectURL(blob);
        
        const newRecording: Recording = {
          id: Date.now().toString(),
          blob,
          url,
          timestamp: Date.now(),
          duration: timer,
          name: `Meeting_${new Date().toISOString().slice(0,10)}_${new Date().getHours()}${new Date().getMinutes()}.${extension}`,
        };
        
        setRecordings(prev => [newRecording, ...prev]);
        setRecorderState(RecorderState.IDLE);
        setTimer(0);
        cleanup();
      };

      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      setRecorderState(RecorderState.RECORDING);

      setTimer(0);
      timerIntervalRef.current = window.setInterval(() => {
        setTimer(t => t + 1);
      }, 1000);

    } catch (err: any) {
      setErrorMsg(err.message || "Failed to start recording");
      setRecorderState(RecorderState.IDLE);
      cleanup();
    }
  };

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const handleDelete = (id: string) => {
    setRecordings(prev => prev.filter(r => r.id !== id));
  };

  const handleAnalyze = async (id: string) => {
    const recording = recordings.find(r => r.id === id);
    if (!recording) return;
    setProcessingIds(prev => new Set(prev).add(id));
    try {
      const { transcription, summary } = await analyzeAudio(recording.blob);
      setRecordings(prev => prev.map(r => r.id === id ? { ...r, transcription, summary } : r));
    } catch (e) {
      alert("AI analysis failed. Check your connection or API Key.");
    } finally {
      setProcessingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col items-center py-10 px-4">
      
      {/* Header */}
      <div className="w-full max-w-2xl flex items-center gap-3 mb-8">
        <Disc className="text-blue-600 w-8 h-8" />
        <h1 className="text-2xl font-bold text-slate-800">EchoMeeting Recorder</h1>
      </div>

      {/* Main Container */}
      <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        
        {/* Visualizer and Time */}
        <div className="mb-6">
          <div className="flex justify-between items-end mb-2">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              {recorderState === RecorderState.RECORDING ? 'Recording...' : 'Idle'}
            </span>
            <span className={`text-2xl font-mono font-bold ${recorderState === RecorderState.RECORDING ? 'text-red-500' : 'text-slate-300'}`}>
              {formatTime(timer)}
            </span>
          </div>
          <AudioVisualizer stream={mixedStreamRef.current} isRecording={recorderState === RecorderState.RECORDING} />
        </div>

        {/* Unified Controls */}
        <div className="flex flex-col gap-6">
          
          {errorMsg && (
            <div className="bg-red-50 text-red-700 p-4 rounded-xl text-sm border border-red-100 flex gap-2">
              <AlertCircle size={18} className="shrink-0" />
              {errorMsg}
            </div>
          )}

          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-slate-100">
            {/* Simple Option */}
            <label className="flex items-center gap-3 cursor-pointer group">
              <input 
                type="checkbox" 
                checked={includeMic} 
                onChange={(e) => setIncludeMic(e.target.checked)}
                disabled={recorderState !== RecorderState.IDLE}
                className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 transition-all cursor-pointer disabled:opacity-50"
              />
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                  <Mic size={14} /> Record my microphone
                </span>
                <span className="text-[10px] text-slate-400 font-medium">Capture your voice (Bluetooth friendly)</span>
              </div>
            </label>

            {/* Simple Primary Button */}
            {recorderState !== RecorderState.RECORDING ? (
              <button 
                onClick={startRecording}
                disabled={recorderState === RecorderState.PREPARING}
                className="w-full sm:w-auto px-10 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {recorderState === RecorderState.PREPARING ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                ) : (
                  <Play size={18} fill="currentColor" />
                )}
                Start Recording
              </button>
            ) : (
              <button 
                onClick={stopRecording}
                className="w-full sm:w-auto px-10 py-3 bg-red-500 hover:bg-red-600 text-white font-bold rounded-xl shadow-md transition-all flex items-center justify-center gap-2"
              >
                <StopCircle size={18} fill="currentColor" />
                Stop Recording
              </button>
            )}
          </div>
        </div>
      </div>

      {/* History List */}
      <div className="w-full max-w-2xl mt-12">
        <h2 className="text-lg font-bold text-slate-700 mb-4 flex items-center gap-2">
          <FileAudio size={20} className="text-slate-400" />
          Recording History
        </h2>
        
        <div className="space-y-4">
          {recordings.length === 0 && (
            <div className="text-center py-12 bg-slate-100/50 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400 text-sm">
              No recordings yet. Click "Start Recording" to begin your meeting.
            </div>
          )}

          {recordings.map((rec) => (
            <div key={rec.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              <div className="p-4 flex items-center gap-4">
                <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600">
                  <FileAudio size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-slate-800 text-sm truncate">{rec.name}</h3>
                  <p className="text-[10px] font-bold text-slate-400 mt-0.5">
                    {formatTime(rec.duration)} • {(rec.blob.size / 1024 / 1024).toFixed(1)} MB
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <audio src={rec.url} controls className="h-8 w-32 hidden sm:block" />
                  <a href={rec.url} download={rec.name} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500" title="Download">
                    <Download size={18} />
                  </a>
                  <button onClick={() => handleDelete(rec.id)} className="p-2 hover:bg-red-50 rounded-lg text-slate-500 hover:text-red-500" title="Delete">
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>

              {/* AI Transcription Section */}
              <div className="px-4 pb-4">
                {!rec.transcription ? (
                  <button 
                    onClick={() => handleAnalyze(rec.id)}
                    disabled={processingIds.has(rec.id)}
                    className="w-full py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-xs font-bold text-slate-600 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                  >
                    {processingIds.has(rec.id) ? "AI Processing..." : <><BrainCircuit size={14} /> Generate AI Summary</>}
                  </button>
                ) : (
                  <div className="mt-2 space-y-3 p-3 bg-slate-50 rounded-lg border border-slate-100">
                    <div>
                      <h4 className="text-[10px] font-black text-blue-600 uppercase mb-1">AI Summary</h4>
                      <p className="text-xs text-slate-700 leading-relaxed">{rec.summary}</p>
                    </div>
                    <details>
                      <summary className="text-[10px] font-bold text-slate-400 cursor-pointer hover:text-slate-600">View Transcript</summary>
                      <p className="text-[11px] text-slate-500 mt-2 whitespace-pre-wrap leading-normal max-h-40 overflow-y-auto">{rec.transcription}</p>
                    </details>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <footer className="mt-auto pt-10 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">
        Ensure 'Share Audio' is checked when sharing your screen | Default export: MP4
      </footer>
    </div>
  );
};

export default App;
