
import React, { useState, useEffect, useRef } from 'react';
import { CalendarService } from './services/calendarService';
import { analyzeMessage } from './services/geminiService';
import { ActionPreview } from './components/ActionPreview';
import { HistoryCard } from './components/HistoryCard';
import { LocalEventRecord, ProposedAction, ActionType } from './types';

// Storage key
const STORAGE_KEY = 'smart_calendar_events_v1';
const CLIENT_ID_STORAGE_KEY = 'smart_calendar_client_id';

const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [inputText, setInputText] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [proposedActions, setProposedActions] = useState<ProposedAction[]>([]);
  const [localEvents, setLocalEvents] = useState<LocalEventRecord[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Auth configuration state
  const [clientId, setClientId] = useState(() => {
    return process.env.GOOGLE_CLIENT_ID || localStorage.getItem(CLIENT_ID_STORAGE_KEY) || '';
  });
  const [showConfig, setShowConfig] = useState(false);
  const [currentOrigin, setCurrentOrigin] = useState('');
  const [isSandboxed, setIsSandboxed] = useState(false);

  const calendarService = useRef(new CalendarService());

  // Load local history on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        setLocalEvents(JSON.parse(stored));
      } catch (e) {
        console.error("Corrupt local storage", e);
      }
    }
    setCurrentOrigin(window.location.origin);
    
    // Check if running in an iframe/sandbox which often breaks Google Auth
    try {
      if (window.self !== window.top) {
        setIsSandboxed(true);
      }
    } catch (e) {
      setIsSandboxed(true);
    }
  }, []);
  
  // Initialize service if we have a stored client ID
  useEffect(() => {
    if (clientId && window.google) {
       try {
         calendarService.current.initializeGis(clientId);
       } catch (e) {
         console.warn("Could not init GIS with current ID", e);
       }
    }
  }, [clientId]);

  const handleAuth = async () => {
    setErrorMsg(null);
    
    if (!clientId) {
      setErrorMsg("Please enter a Google Client ID to connect.");
      setShowConfig(true);
      return;
    }

    // Ensure service uses current ID
    try {
       calendarService.current.initializeGis(clientId);
       localStorage.setItem(CLIENT_ID_STORAGE_KEY, clientId); // Save for later
    } catch (e) {
       console.error(e);
       setErrorMsg("Invalid Client ID format or GIS not ready.");
       return;
    }

    try {
      await calendarService.current.requestAuth();
      setIsAuthenticated(true);
      setShowConfig(false);
    } catch (err: any) {
      console.error(err);
      if (err.type === 'token_failed') {
          setErrorMsg("Authorization failed. Please try again.");
      } else {
          // Provide a specific hint for the 400 storagerelay error
          setErrorMsg("Sign-in failed. If you see a '400' error, try opening this app in a New Window (outside the preview frame) or use Lite Mode.");
      }
    }
  };

  const handleAnalyze = async () => {
    if (!inputText.trim()) return;
    setIsAnalyzing(true);
    setErrorMsg(null);
    setProposedActions([]);

    try {
      // Pass localEvents as context so AI knows what exists
      const result = await analyzeMessage(inputText, localEvents);
      setProposedActions(result.actions);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to analyze text.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleExecuteAction = async (action: ProposedAction, index: number) => {
    setIsSyncing(true);
    try {
      let gcalId = 'manual-link-' + Date.now(); // Default for manual mode

      // If Authenticated, try to use API
      if (isAuthenticated && calendarService.current.isAuthenticated()) {
        try {
          if (action.type === ActionType.CREATE && action.eventData) {
            const gcalResponse = await calendarService.current.createEvent(action.eventData);
            gcalId = gcalResponse.id;
          } else if (action.type === ActionType.UPDATE && action.targetLocalId && action.eventData) {
             const targetRecord = localEvents.find(e => e.localId === action.targetLocalId);
             if (targetRecord) {
               await calendarService.current.updateEvent(targetRecord.gcalId, action.eventData);
               gcalId = targetRecord.gcalId;
             }
          }
        } catch (authErr: any) {
          console.error("API Error", authErr);
          setErrorMsg("API Error: " + (authErr.result?.error?.message || authErr.message) + ". Event saved locally only.");
          // Fallback: Continue to save locally even if API failed, or if user just clicked the link
        }
      }

      // 2. Update Local State (Always do this, even if using Links, to maintain context)
      if (action.type === ActionType.CREATE && action.eventData) {
        const newRecord: LocalEventRecord = {
          ...action.eventData,
          localId: crypto.randomUUID(),
          gcalId: gcalId,
          lastUpdated: new Date().toISOString(),
        };

        const updatedList = [...localEvents, newRecord];
        setLocalEvents(updatedList);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedList));

      } else if (action.type === ActionType.UPDATE && action.targetLocalId && action.eventData) {
        const updatedList = localEvents.map(e => {
          if (e.localId === action.targetLocalId) {
            return {
              ...e,
              ...action.eventData!,
              lastUpdated: new Date().toISOString(),
            };
          }
          return e;
        });

        setLocalEvents(updatedList);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedList));
      }

      // Remove executed action from list
      setProposedActions(prev => prev.filter((_, i) => i !== index));
      if (proposedActions.length === 1) {
          setInputText(''); // Clear input if all done
      }

    } catch (err: any) {
      console.error(err);
      setErrorMsg("Error processing action: " + err.message);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDismissAction = (index: number) => {
    setProposedActions(prev => prev.filter((_, i) => i !== index));
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
          
          <div className="flex flex-col items-end gap-2 w-full md:w-auto">
            {/* Auth UI */}
            {!isAuthenticated ? (
              <div className="flex flex-col items-end w-full">
                 <div className="flex items-center gap-2">
                    {/* Toggle Settings */}
                    <button 
                      onClick={() => setShowConfig(!showConfig)}
                      className="text-xs text-slate-400 hover:text-sky-600 underline"
                    >
                      {showConfig ? 'Hide Config' : 'Configure Client ID (Optional)'}
                    </button>

                    <button
                      onClick={handleAuth}
                      className="flex items-center gap-2 bg-white text-slate-700 border border-slate-200 px-4 py-2 rounded-full font-semibold hover:bg-slate-50 hover:shadow-sm transition-all whitespace-nowrap text-sm"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                      </svg>
                      Connect Account
                    </button>
                 </div>

                 {/* Client ID Input */}
                 {showConfig && (
                  <div className="flex flex-col items-end w-full max-w-sm animate-fade-in mt-2 bg-white p-4 rounded-lg border border-slate-200 shadow-xl z-20 absolute top-20 right-0 md:relative md:top-0 md:right-0">
                     <label className="text-xs text-slate-500 mb-1 w-full text-left font-semibold">Google Client ID</label>
                     <input 
                       type="text" 
                       value={clientId}
                       onChange={(e) => setClientId(e.target.value)}
                       placeholder="Enter Client ID..."
                       className="w-full text-sm border border-slate-300 rounded px-2 py-1 focus:ring-2 focus:ring-sky-500 focus:outline-none mb-3"
                     />
                     
                     <div className="bg-slate-50 p-2 rounded border border-slate-200 w-full mb-3 text-left">
                       <p className="text-[10px] text-slate-400 uppercase tracking-wider font-bold mb-1">Copy to "Authorized JavaScript origins":</p>
                       <code className="text-xs text-slate-700 bg-white border border-slate-200 px-1 py-0.5 rounded block break-all select-all">
                         {currentOrigin || 'Loading...'}
                       </code>
                     </div>

                     <div className="text-[10px] text-amber-600 bg-amber-50 p-2 rounded mb-3 text-left leading-tight">
                        <strong>Tip:</strong> If you see "Error 400: redirect_uri_mismatch" or "storagerelay", ensure the origin above exactly matches your Console settings. 
                        If running in a code editor preview, try opening the app in a new window.
                     </div>

                     <div className="flex justify-between w-full mt-1 items-center">
                        <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" className="text-xs text-sky-600 hover:underline flex items-center gap-1">
                          Google Cloud Console
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                        </a>
                        <button onClick={() => setShowConfig(false)} className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1 rounded hover:bg-slate-100">Done</button>
                     </div>
                  </div>
                 )}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-emerald-700 bg-emerald-100 px-3 py-1 rounded-full text-sm border border-emerald-200">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                Connected
              </div>
            )}
          </div>
        </header>

        {/* Sandboxed Environment Warning */}
        {isSandboxed && (
           <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-2 rounded-lg mb-4 text-sm flex justify-between items-center">
             <div className="flex gap-2 items-center">
               <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
               <span>Preview environment detected. Sign-in may fail.</span>
             </div>
             <a href={window.location.href} target="_blank" rel="noopener noreferrer" className="text-amber-700 underline font-semibold hover:text-amber-900">
               Open in New Window
             </a>
           </div>
        )}

        {/* Info Banner for No-Auth Mode */}
        {!isAuthenticated && (
          <div className="bg-sky-50 border border-sky-100 text-sky-800 px-4 py-3 rounded-xl mb-6 flex gap-3 text-sm">
             <svg className="w-5 h-5 text-sky-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
             </svg>
             <p>
               <span className="font-semibold">Lite Mode:</span> You are not signed in. The AI will still analyze your messages, but instead of automatically syncing, it will generate <span className="font-semibold">"Open in Calendar"</span> links for you to save manually.
             </p>
          </div>
        )}

        {/* Main Content Area */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left Column: Input & Actions */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Input Section */}
            <div className="bg-white rounded-2xl p-1 shadow-lg shadow-slate-200/50 border border-slate-100">
              <div className="relative">
                <textarea
                  className="w-full bg-slate-50 text-slate-800 rounded-xl p-4 min-h-[150px] focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:bg-white transition-colors resize-none placeholder-slate-400 border border-slate-200"
                  placeholder="Paste chat messages here... e.g. 'Hey, meeting rescheduled to Friday at 3pm'"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  disabled={isAnalyzing}
                />
                <div className="absolute bottom-3 right-3 flex items-center gap-2">
                   {inputText.length > 0 && (
                       <span className="text-xs text-slate-400">{inputText.length} chars</span>
                   )}
                   <button
                    onClick={handleAnalyze}
                    disabled={!inputText.trim() || isAnalyzing}
                    className="bg-sky-600 hover:bg-sky-500 text-white p-2 rounded-lg transition-all disabled:opacity-50 disabled:grayscale flex items-center gap-2 font-medium pr-4 pl-3 shadow-md shadow-sky-600/20"
                  >
                    {isAnalyzing ? (
                      <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                      </svg>
                    )}
                    {isAnalyzing ? 'Processing...' : 'Analyze'}
                  </button>
                </div>
              </div>
            </div>

            {/* Error Message */}
            {errorMsg && (
              <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg flex items-center gap-3 animate-fade-in">
                 <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                 </svg>
                 <span>{errorMsg}</span>
              </div>
            )}

            {/* Proposed Actions Area */}
            {proposedActions.length > 0 && (
              <div className="animate-fade-in">
                <h2 className="text-xl font-semibold mb-4 text-slate-700">Proposed Actions</h2>
                {proposedActions.map((action, idx) => (
                  <ActionPreview
                    key={idx}
                    action={action}
                    isProcessing={isSyncing}
                    isAuthenticated={isAuthenticated}
                    onConfirm={() => handleExecuteAction(action, idx)}
                    onCancel={() => handleDismissAction(idx)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Right Column: Managed History */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 h-fit sticky top-4">
             <div className="flex justify-between items-center mb-4">
               <h3 className="font-semibold text-slate-700">Managed Events</h3>
               <span className="text-xs bg-slate-100 px-2 py-1 rounded text-slate-500 border border-slate-200">{localEvents.length} total</span>
             </div>
             
             {localEvents.length === 0 ? (
               <div className="text-center py-10 text-slate-400 border-2 border-dashed border-slate-200 rounded-lg">
                 <p>No events tracked yet.</p>
                 <p className="text-xs mt-1">Paste a message to start.</p>
               </div>
             ) : (
               <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2">
                 {[...localEvents]
                   .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
                   .map(event => (
                   <HistoryCard key={event.localId} event={event} />
                 ))}
               </div>
             )}
          </div>

        </div>
      </div>
    </div>
  );
};

export default App;
