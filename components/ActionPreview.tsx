
import React from 'react';
import { ProposedAction, ActionType } from '../types';
import { CalendarService } from '../services/calendarService';

interface Props {
  action: ProposedAction;
  onConfirm: () => void;
  onCancel: () => void;
  isProcessing: boolean;
  isAuthenticated: boolean;
}

export const ActionPreview: React.FC<Props> = ({ action, onConfirm, onCancel, isProcessing, isAuthenticated }) => {
  const isCreate = action.type === ActionType.CREATE;
  const calendarService = new CalendarService(); // Helper for link generation
  
  if (action.type === ActionType.IGNORE) {
      return (
          <div className="bg-white border border-slate-200 rounded-xl p-4 my-4 shadow-sm">
              <p className="text-slate-500 italic">No calendar events found in text.</p>
              <div className="mt-2 text-xs text-slate-400">{action.reasoning}</div>
              <button onClick={onCancel} className="mt-3 text-sm text-slate-500 hover:text-slate-900 underline">Dismiss</button>
          </div>
      )
  }

  const data = action.eventData;

  // Generate link for unauthenticated users
  const webLink = (!isAuthenticated && data) ? calendarService.generateCalendarUrl(data) : null;

  return (
    <div className={`rounded-xl p-5 mb-4 border-l-4 shadow-md ${isCreate ? 'bg-emerald-50 border-emerald-500' : 'bg-amber-50 border-amber-500'}`}>
      <div className="flex justify-between items-center mb-3">
        <span className={`text-xs font-bold px-2 py-1 rounded uppercase tracking-wider ${isCreate ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
          {action.type}
        </span>
        <span className="text-xs text-slate-500">Confidence: {(action.confidenceScore * 100).toFixed(0)}%</span>
      </div>

      <div className="space-y-2 mb-4">
        <h3 className="text-xl font-bold text-slate-800">{data?.summary || 'Untitled Event'}</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div className="text-slate-600">
             <span className="block text-slate-400 text-xs mb-1">Start Time</span>
             {data?.startTime ? new Date(data.startTime).toLocaleString() : 'N/A'}
          </div>
          <div className="text-slate-600">
             <span className="block text-slate-400 text-xs mb-1">End Time</span>
             {data?.endTime ? new Date(data.endTime).toLocaleString() : 'N/A'}
          </div>
        </div>

        {data?.location && (
          <div className="text-sm text-slate-600">
             <span className="text-slate-400">Location: </span> {data.location}
          </div>
        )}
        
        <div className="bg-white/60 p-2 rounded text-xs text-slate-500 italic mt-2 border border-slate-200">
          Reasoning: {action.reasoning}
        </div>
        
        {!isAuthenticated && action.type === ActionType.UPDATE && (
          <div className="text-xs text-amber-600 font-medium mt-2">
            * Note: Without signing in, you must manually update the event in your calendar. The button below will open a pre-filled create form.
          </div>
        )}
      </div>

      <div className="flex gap-3 mt-4">
        {isAuthenticated ? (
          <button
            onClick={onConfirm}
            disabled={isProcessing}
            className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${
              isCreate 
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white' 
                : 'bg-amber-600 hover:bg-amber-500 text-white'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {isProcessing ? 'Syncing...' : (isCreate ? 'Add to Calendar' : 'Update Event')}
          </button>
        ) : (
           <a
            href={webLink || '#'}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onConfirm} // We still trigger onConfirm to save to local history
            className={`flex-1 py-2 px-4 rounded-lg font-medium text-center transition-colors flex items-center justify-center gap-2 ${
              isCreate 
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white' 
                : 'bg-amber-600 hover:bg-amber-500 text-white'
            }`}
          >
            <span>Open in Google Calendar</span>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        )}
        
        <button
          onClick={onCancel}
          disabled={isProcessing}
          className="px-4 py-2 rounded-lg border border-slate-300 text-slate-500 hover:bg-white hover:text-slate-800 hover:border-slate-400 hover:shadow-sm transition-all disabled:opacity-50"
        >
          Reject
        </button>
      </div>
    </div>
  );
};
