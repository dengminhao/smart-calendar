import React, { useState, useEffect, useRef } from 'react';
import { CalendarService } from './services/calendarService';
import { analyzeMessage, fixActionWithAI } from './services/aiService';
import { ActionPreview } from './components/ActionPreview';
import { HistoryCard } from './components/HistoryCard';
import { LocalEventRecord, ProposedAction, ActionType, CalendarEventData, AIProvider } from './types';

// Storage keys
const STORAGE_KEY = 'smart_calendar_events_v2';
const CLIENT_ID_STORAGE_KEY = 'smart_calendar_client_id';

const AI_CONFIG_KEY = 'smart_calendar_ai_config';

const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [inputText, setInputText] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [proposedActions, setProposedActions] = useState<ProposedAction[]>([]);
  const [localEvents, setLocalEvents] = useState<LocalEventRecord[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [autoTrust, setAutoTrust] = useState(false);
  
  // --- Configuration State ---
  const [clientId, setClientId] = useState(() => {
    return process.env.GOOGLE_CLIENT_ID || localStorage.getItem(CLIENT_ID_STORAGE_KEY) || '';
  });

  // AI Provider Config
  const [aiProvider, setAiProvider] = useState<AIProvider>(() => (process.env.AI_PROVIDER as AIProvider) || 'GEMINI');
  
  // Gemini Config
  const [geminiApiKey, setGeminiApiKey] = useState(() => process.env.API_KEY || ''); // Often auto-injected
  const [geminiBaseUrl, setGeminiBaseUrl] = useState(() => process.env.GEMINI_BASE_URL || '');
  
  // OpenAI Config
  const [openaiApiKey, setOpenaiApiKey] = useState(() => process.env.OPENAI_API_KEY || '');
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState(() => process.env.OPENAI_BASE_URL || '');
  const [openaiModel, setOpenaiModel] = useState(() => process.env.OPENAI_MODEL || 'gpt-4o');

  const [showConfig, setShowConfig] = useState(false);
  const [isSandboxed, setIsSandboxed] = useState(false);

  const calendarService = useRef(new CalendarService());

  // Load persistence
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        setLocalEvents(JSON.parse(stored));
      } catch (e) { console.error("Corrupt storage", e); }
    }
    
    // Restore manual AI configs if saved
    const storedAiConfig = localStorage.getItem(AI_CONFIG_KEY);
    if (storedAiConfig) {
      const parsed = JSON.parse(storedAiConfig);
      if (parsed.provider) setAiProvider(parsed.provider);
      if (parsed.geminiBaseUrl) setGeminiBaseUrl(parsed.geminiBaseUrl);
      if (parsed.openaiApiKey) setOpenaiApiKey(parsed.openaiApiKey);
      if (parsed.openaiBaseUrl) setOpenaiBaseUrl(parsed.openaiBaseUrl);
      if (parsed.openaiModel) setOpenaiModel(parsed.openaiModel);
    }

    try {
      if (window.self !== window.top) setIsSandboxed(true);
    } catch (e) { setIsSandboxed(true); }
  }, []);

  // Sync GIS if ID changes
  useEffect(() => {
    if (clientId && window.google) {
       try {
         calendarService.current.initializeGis(clientId);
       } catch (e) { console.warn("GIS init warning", e); }
    }
  }, [clientId]);

  const handleSaveConfig = () => {
    if (clientId) localStorage.setItem(CLIENT_ID_STORAGE_KEY, clientId);
    
    // Save AI configs
    const configToSave = {
      provider: aiProvider,
      geminiBaseUrl,
      openaiApiKey,
      openaiBaseUrl,
      openaiModel
    };
    localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(configToSave));
    
    setShowConfig(false);
  };

  const handleAuth = async () => {
    setErrorMsg(null);
    if (!clientId) {
      setErrorMsg("Please enter a Google Client ID first.");
      setShowConfig(true);
      return;
    }
    try {
      calendarService.current.initializeGis(clientId);
      await calendarService.current.requestAuth();
      setIsAuthenticated(true);
      setShowConfig(false);
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Sign-in failed. Check Client ID or open in new window.");
    }
  };

  const getAiConfig = () => {
    if (aiProvider === 'OPENAI') {
      return {
        provider: 'OPENAI' as AIProvider,
        apiKey: openaiApiKey,
        baseUrl: openaiBaseUrl || undefined,
        model: openaiModel
      };
    } else {
      return {
        provider: 'GEMINI' as AIProvider,
        apiKey: geminiApiKey, // Usually pre-filled by env
        baseUrl: geminiBaseUrl || undefined,
        model: 'gemini-2.5-flash'
      };
    }
  };

  const handleAnalyze = async () => {
    if (!inputText.trim()) return;
    setIsAnalyzing(true);
    setErrorMsg(null);
    setProposedActions([]);

    try {
      const config = getAiConfig();
      const result = await analyzeMessage(inputText, localEvents, config);
      
      const actions = result.actions;
      setProposedActions(actions);

      // Auto-Trust Execution
      if (autoTrust && isAuthenticated) {
        const highConfidenceActions = actions.filter(
          a => a.confidenceScore > 0.85 && (a.type === ActionType.CREATE || a.type === ActionType.UPDATE)
        );
        
        if (highConfidenceActions.length > 0) {
          for (const action of highConfidenceActions) {
            await handleExecuteAction(action, actions.indexOf(action), true);
          }
          setProposedActions(prev => prev.filter(p => !highConfidenceActions.includes(p)));
          setInputText('');
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to analyze text.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleExecuteAction = async (action: ProposedAction, index: number, isAuto = false) => {
    setIsSyncing(true);
    setErrorMsg(null);

    const targetRecord = action.targetLocalId ? localEvents.find(e => e.localId === action.targetLocalId) : null;
    let mergedEventData = (action.type === ActionType.UPDATE && targetRecord)
      ? { ...targetRecord, ...action.eventData } 
      : action.eventData;

    if (!mergedEventData) {
      setIsSyncing(false);
      return;
    }

    let finalGCalId = targetRecord?.gcalId || ('manual-link-' + Date.now());
    let synced = false;
    let syncError: string | undefined = undefined;

    if (isAuthenticated && calendarService.current.isAuthenticated()) {
       try {
          finalGCalId = await performSync(action.type, finalGCalId, mergedEventData, targetRecord);
          synced = true;
       } catch (err: any) {
         console.warn("Sync failed, trying AI Fix:", err.message);
         try {
           const fixedData = await fixActionWithAI(mergedEventData, err.message, getAiConfig());
           mergedEventData = { ...mergedEventData, ...fixedData };
           finalGCalId = await performSync(action.type, finalGCalId, mergedEventData, targetRecord);
           synced = true;
         } catch (retryErr: any) {
           synced = false;
           syncError = retryErr.message;
           if (!isAuto) setErrorMsg(`Sync Failed: ${retryErr.message}. Saved locally.`);
         }
       }
    }

    updateLocalState(action.type, mergedEventData, finalGCalId, synced, syncError, targetRecord?.localId);
    
    if (!isAuto) {
      setProposedActions(prev => prev.filter((_, i) => i !== index));
      if (proposedActions.length === 1) setInputText('');
    }
    setIsSyncing(false);
  };

  const performSync = async (type: ActionType, gcalId: string, data: CalendarEventData, targetRecord: LocalEventRecord | null | undefined): Promise<string> => {
      const isManual = gcalId.startsWith('manual-link-');
      
      if (type === ActionType.CREATE || (type === ActionType.UPDATE && isManual)) {
         const resp = await calendarService.current.createEvent(data);
         return resp.id;
      } else {
         try {
           await calendarService.current.updateEvent(gcalId, data);
           return gcalId;
         } catch (e: any) {
           if (e.message.includes('404')) {
             const searchDate = new Date(targetRecord?.startTime || data.startTime);
             const timeMin = new Date(searchDate); timeMin.setHours(0,0,0,0);
             const timeMax = new Date(searchDate); timeMax.setHours(23,59,59,999);
             const dayEvents = await calendarService.current.listEvents(timeMin.toISOString(), timeMax.toISOString());
             const match = dayEvents.find((e: any) => e.summary === (targetRecord?.summary || data.summary));
             if (match) {
               await calendarService.current.updateEvent(match.id, data);
               return match.id;
             } else {
               const resp = await calendarService.current.createEvent(data);
               return resp.id;
             }
           }
           throw e;
         }
      }
  };

  const updateLocalState = (type: ActionType, data: CalendarEventData, gcalId: string, synced: boolean, error: string | undefined, targetLocalId?: string) => {
    setLocalEvents(prev => {
      let next = [...prev];
      const now = new Date().toISOString();
      if (type === ActionType.CREATE) {
        next.push({
          ...data,
          localId: crypto.randomUUID(),
          gcalId,
          lastUpdated: now,
          originalText: inputText,
          synced,
          error
        });
      } else if (type === ActionType.UPDATE && targetLocalId) {
        next = next.map(e => e.localId === targetLocalId ? {
          ...e, ...data, gcalId, lastUpdated: now, synced, error: error || undefined
        } : e);
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const handleRetry = async (record: LocalEventRecord) => {
    setIsSyncing(true);
    try {
      const action: ProposedAction = {
        type: ActionType.UPDATE,
        confidenceScore: 1,
        reasoning: "Manual Retry",
        eventData: record,
        targetLocalId: record.localId
      };
      await handleExecuteAction(action, -1, true); 
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-4 md:p-8 font-sans">
      <div className="max-w-4xl mx-auto">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 border-b border-slate-200 pb-6 gap-4">
          <div>
            <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-sky-600 to-indigo-600">
              Smart Calendar Sync
            </h1>
            <p className="text-slate-500 mt-1">Transform chats into events with AI.</p>
          </div>
          
          <div className="flex flex-col items-end gap-2 w-full md:w-auto relative">
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setShowConfig(!showConfig)}
                className="text-xs text-slate-400 hover:text-sky-600 underline"
              >
                {showConfig ? 'Close Settings' : 'Settings'}
              </button>

              {!isAuthenticated ? (
                <button
                  onClick={handleAuth}
                  className="flex items-center gap-2 bg-white text-slate-700 border border-slate-200 px-4 py-2 rounded-full font-semibold hover:bg-slate-50 transition-all text-sm"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /></svg>
                  Connect
                </button>
              ) : (
                 <div className="flex items-center gap-3">
                   <label className="flex items-center gap-2 cursor-pointer group">
                     <div className="relative">
                       <input type="checkbox" className="sr-only" checked={autoTrust} onChange={(e) => setAutoTrust(e.target.checked)} />
                       <div className={`w-8 h-4 rounded-full shadow-inner transition-colors ${autoTrust ? 'bg-sky-500' : 'bg-slate-300'}`}></div>
                       <div className={`absolute -top-1 -left-1 w-6 h-6 bg-white rounded-full shadow transition-transform ${autoTrust ? 'translate-x-4' : 'translate-x-0'}`}></div>
                     </div>
                     <span className="text-xs font-medium text-slate-500 group-hover:text-sky-600">Auto-Sync</span>
                   </label>
                  <span className="text-xs text-emerald-600 bg-emerald-50 px-2 py-1 rounded border border-emerald-100">Connected</span>
                </div>
              )}
            </div>

            {/* Config Panel */}
            {showConfig && (
              <div className="absolute top-12 right-0 w-80 bg-white p-5 rounded-xl border border-slate-200 shadow-xl z-50 animate-fade-in text-sm">
                 <h3 className="font-bold text-slate-700 mb-3">Settings</h3>
                 
                 <div className="mb-4">
                   <label className="block text-xs font-semibold text-slate-500 mb-1">Google Client ID</label>
                   <input 
                     type="text" 
                     value={clientId}
                     onChange={(e) => setClientId(e.target.value)}
                     className="w-full border border-slate-300 rounded px-2 py-1.5 focus:ring-2 focus:ring-sky-500 focus:outline-none"
                     placeholder="OAuth 2.0 Client ID"
                   />
                 </div>

                 <div className="border-t border-slate-100 my-3 pt-3">
                   <label className="block text-xs font-semibold text-slate-500 mb-2">AI Provider</label>
                   <div className="flex bg-slate-100 p-1 rounded-lg mb-3">
                     <button 
                       onClick={() => setAiProvider('GEMINI')}
                       className={`flex-1 py-1 text-xs font-medium rounded-md transition-all ${aiProvider === 'GEMINI' ? 'bg-white shadow text-sky-600' : 'text-slate-500 hover:text-slate-700'}`}
                     >
                       Gemini
                     </button>
                     <button 
                       onClick={() => setAiProvider('OPENAI')}
                       className={`flex-1 py-1 text-xs font-medium rounded-md transition-all ${aiProvider === 'OPENAI' ? 'bg-white shadow text-sky-600' : 'text-slate-500 hover:text-slate-700'}`}
                     >
                       OpenAI
                     </button>
                   </div>

                   {aiProvider === 'GEMINI' ? (
                      <div className="space-y-2">
                        <div>
                          <label className="block text-[10px] text-slate-400 mb-1">Base URL (Optional)</label>
                          <input 
                            type="text" 
                            value={geminiBaseUrl}
                            onChange={(e) => setGeminiBaseUrl(e.target.value)}
                            placeholder="https://generativelanguage.googleapis.com"
                            className="w-full border border-slate-300 rounded px-2 py-1"
                          />
                        </div>
                        <p className="text-[10px] text-slate-400">API Key is usually handled via environment variables.</p>
                      </div>
                   ) : (
                      <div className="space-y-2">
                        <div>
                          <label className="block text-[10px] text-slate-400 mb-1">OpenAI API Key</label>
                          <input 
                            type="password" 
                            value={openaiApiKey}
                            onChange={(e) => setOpenaiApiKey(e.target.value)}
                            className="w-full border border-slate-300 rounded px-2 py-1"
                            placeholder="sk-..."
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-400 mb-1">Model Name</label>
                          <input 
                            type="text" 
                            value={openaiModel}
                            onChange={(e) => setOpenaiModel(e.target.value)}
                            className="w-full border border-slate-300 rounded px-2 py-1"
                            placeholder="gpt-4o"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-400 mb-1">Base URL (Optional)</label>
                          <input 
                            type="text" 
                            value={openaiBaseUrl}
                            onChange={(e) => setOpenaiBaseUrl(e.target.value)}
                            className="w-full border border-slate-300 rounded px-2 py-1"
                            placeholder="https://api.openai.com"
                          />
                        </div>
                      </div>
                   )}
                 </div>

                 <button onClick={handleSaveConfig} className="w-full bg-slate-800 hover:bg-slate-700 text-white py-1.5 rounded-lg text-xs font-medium transition-colors">
                   Save & Close
                 </button>
              </div>
            )}
          </div>
        </header>

        {isSandboxed && (
           <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-2 rounded-lg mb-6 text-sm flex justify-between items-center">
             <span>Preview detected. Sign-in may require a new window.</span>
             <a href={window.location.href} target="_blank" rel="noopener noreferrer" className="text-amber-700 underline font-semibold">Open New Window</a>
           </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-2xl p-1 shadow-lg shadow-slate-200/50 border border-slate-100">
              <div className="relative">
                <textarea
                  className="w-full bg-slate-50 text-slate-800 rounded-xl p-4 min-h-[150px] focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:bg-white transition-colors resize-none placeholder-slate-400 border border-slate-200"
                  placeholder={`Paste chat messages here...\nCurrently using: ${aiProvider}`}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  disabled={isAnalyzing}
                />
                <div className="absolute bottom-3 right-3 flex items-center gap-2">
                   <button
                    onClick={handleAnalyze}
                    disabled={!inputText.trim() || isAnalyzing}
                    className="bg-sky-600 hover:bg-sky-500 text-white p-2 rounded-lg transition-all disabled:opacity-50 flex items-center gap-2 font-medium pr-4 pl-3 shadow-md"
                  >
                    {isAnalyzing ? 'Processing...' : 'Analyze'}
                  </button>
                </div>
              </div>
            </div>

            {errorMsg && (
              <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg flex items-center gap-3">
                 <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                 <span>{errorMsg}</span>
              </div>
            )}

            {proposedActions.length > 0 && (
              <div>
                <h2 className="text-xl font-semibold mb-4 text-slate-700">Proposed Actions</h2>
                {proposedActions.map((action, idx) => (
                  <ActionPreview
                    key={idx}
                    action={action}
                    isProcessing={isSyncing}
                    isAuthenticated={isAuthenticated}
                    onConfirm={() => handleExecuteAction(action, idx)}
                    onCancel={() => setProposedActions(prev => prev.filter((_, i) => i !== idx))}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 h-fit sticky top-4">
             <div className="flex justify-between items-center mb-4">
               <h3 className="font-semibold text-slate-700">Managed Events</h3>
               <span className="text-xs bg-slate-100 px-2 py-1 rounded text-slate-500">{localEvents.length}</span>
             </div>
             <div className="space-y-2 max-h-[500px] overflow-y-auto">
               {[...localEvents].sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime()).map(e => (
                   <HistoryCard key={e.localId} event={e} onRetry={handleRetry} />
               ))}
             </div>
          </div>

        </div>
      </div>
    </div>
  );
};

export default App;
