import React from 'react';
import { LocalEventRecord } from '../types';

interface Props {
  event: LocalEventRecord;
}

export const HistoryCard: React.FC<Props> = ({ event }) => {
  const start = new Date(event.startTime);
  const end = new Date(event.endTime);

  return (
    <div className="bg-white rounded-lg p-4 mb-3 border border-slate-200 shadow-sm opacity-90 hover:opacity-100 hover:shadow-md transition-all">
      <div className="flex justify-between items-start">
        <h4 className="font-semibold text-sky-700">{event.summary}</h4>
        <span className="text-xs text-slate-400 font-mono">ID: {event.localId.slice(0, 4)}...</span>
      </div>
      <div className="mt-2 text-sm text-slate-600">
        <p className="flex items-center gap-2">
          <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {start.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          {' - '}
          {end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
        {event.location && (
          <p className="flex items-center gap-2 mt-1">
             <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {event.location}
          </p>
        )}
      </div>
    </div>
  );
};