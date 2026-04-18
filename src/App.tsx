/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { 
  Upload, 
  Search, 
  MessageSquare, 
  User, 
  Calendar, 
  ArrowLeft, 
  Download,
  Info,
  Share2,
  Copy,
  Check,
  Menu,
  X,
  ChevronUp
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Participant {
  name: string;
}

interface Message {
  sender_name: string;
  timestamp_ms: number;
  content?: string;
  type: string;
  photos?: { uri: string }[];
  videos?: { uri: string }[];
  audio_files?: { uri: string }[];
  share?: { link: string; share_text?: string };
}

interface InstagramExport {
  participants: Participant[];
  messages: Message[];
  title: string;
}

// Helper to fix Instagram's weird UTF-8 encoding in JSON exports
const fixEncoding = (text: string | undefined): string => {
  if (!text) return '';
  try {
    // Instagram JSON encodes UTF-8 characters as ISO-8859-1
    return decodeURIComponent(escape(text));
  } catch (e) {
    return text; // Fallback if decoding fails
  }
};

const formatDate = (timestamp: number) => {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
};

export default function App() {
  const [data, setData] = useState<InstagramExport | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [meName, setMeName] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Auto-merge multiple files on load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const chatId = params.get('chat');
    
    setLoading(true);
    
    const loadData = async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

      try {
        if (chatId) {
          // Shared link logic (Single file from server)
          const res = await fetch(`/api/chat/${chatId}`, { signal: controller.signal });
          if (!res.ok) throw new Error("Shared archive not found.");
          const json = await res.json();
          if (json.error) throw new Error(json.error);
          setData(mergeAndSortMessages([json]));
          if (json.participants?.length > 0) setMeName(json.participants[0].name);
          return;
        }

        // Default logic: Try loading multiple parts from /data/message_X.json
        const parts: InstagramExport[] = [];
        let index = 1;
        let hasMore = true;

        while (hasMore && index <= 50) { // Limit to 50 files for safety
          try {
            const res = await fetch(`/data/message_${index}.json`, { signal: controller.signal });
            if (!res.ok) {
              // Fallback: try root chat_data.json if message_1 doesn't exist
              if (index === 1) {
                const rootRes = await fetch('/chat_data.json', { signal: controller.signal });
                if (rootRes.ok) parts.push(await rootRes.json());
              }
              hasMore = false;
              break;
            }
            const part = await res.json();
            parts.push(part);
            index++;
          } catch (e) {
            hasMore = false;
          }
        }

        if (parts.length > 0) {
          const merged = mergeAndSortMessages(parts);
          setData(merged);
          if (merged.participants.length > 0) setMeName(merged.participants[0].name);
        }
      } catch (err) {
        console.error("Load error:", err);
        if (chatId) alert("Failed to retrieve shared archive.");
      } finally {
        clearTimeout(timeoutId);
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const mergeAndSortMessages = (archives: InstagramExport[]): InstagramExport => {
    if (archives.length === 0) return { participants: [], messages: [], title: "" };
    
    let allMessages: Message[] = [];
    const participantsSet = new Set<string>();
    let title = archives[0].title || "Merged Archive";

    archives.forEach(arc => {
      if (arc.messages) {
        // Safe way to combine large arrays
        allMessages = allMessages.concat(arc.messages);
      }
      if (arc.participants) {
        arc.participants.forEach(p => participantsSet.add(p.name));
      }
    });

    // Deduplicate by timestamp and content
    // We use a Map for O(n) deduplication
    const messageMap = new Map<string, Message>();
    for (const m of allMessages) {
      const key = `${m.timestamp_ms}-${m.content}-${m.sender_name}`;
      if (!messageMap.has(key)) {
        messageMap.set(key, m);
      }
    }
    
    const uniqueMessages = Array.from(messageMap.values());

    // Sort Chronologically (Oldest to Newest)
    uniqueMessages.sort((a, b) => a.timestamp_ms - b.timestamp_ms);

    return {
      title,
      participants: Array.from(participantsSet).map(name => ({ name })),
      messages: uniqueMessages
    };
  };

  const handleFileUpload = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    
    setLoading(true);
    const parts: InstagramExport[] = [];

    for (const file of Array.from(files)) {
      if (file.type === 'application/json' || file.name.endsWith('.json')) {
        const text = await file.text();
        try {
          const json = JSON.parse(text) as InstagramExport;
          if (json.messages && json.participants) {
            parts.push(json);
          }
        } catch (err) {
          console.error(`Failed to parse ${file.name}`);
        }
      }
    }

    if (parts.length > 0) {
      const merged = mergeAndSortMessages(parts);
      setData(merged);
      if (merged.participants.length > 0) setMeName(merged.participants[0].name);
    } else {
      alert("No valid Instagram JSON files found in selection.");
    }
    setLoading(false);
  }, []);

  const handleShare = async () => {
    if (!data) return;
    setIsSharing(true);
    try {
      const resp = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data })
      });
      const { id } = await resp.json();
      const url = `${window.location.origin}${window.location.pathname}?chat=${id}`;
      setShareUrl(url);
    } catch (err) {
      console.error(err);
      alert("Failed to create shareable link.");
    } finally {
      setIsSharing(false);
    }
  };

  const copyToClipboard = () => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl);
    setCopying(true);
    setTimeout(() => setCopying(false), 2000);
  };

  const filteredMessages = useMemo(() => {
    if (!data) return [];
    if (!searchTerm) return data.messages;
    
    const lowerSearch = searchTerm.toLowerCase();
    return data.messages.filter(msg => {
      const content = fixEncoding(msg.content).toLowerCase();
      const sender = fixEncoding(msg.sender_name).toLowerCase();
      return content.includes(lowerSearch) || sender.includes(lowerSearch);
    });
  }, [data, searchTerm]);

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => {
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileUpload(e.dataTransfer.files);
  };

  if (loading) {
    return (
    <div className="min-h-[100dvh] bg-[#f4f4f0] flex items-center justify-center font-sans p-8">
        <div className="bg-white border-4 border-black p-8 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] text-center max-w-sm w-full">
           <div className="animate-spin w-10 h-10 border-4 border-black border-t-transparent inline-block mb-4"></div>
           <p className="font-black uppercase tracking-tighter text-xl">Retrieving Archive...</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
    <div className="min-h-[100dvh] bg-[#f4f4f0] p-4 flex items-center justify-center font-sans">
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="max-w-2xl w-full bg-white border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] p-8 md:p-12 space-y-8"
        >
          <div className="space-y-4">
            <div className="inline-block bg-[#ffda58] border-2 border-black px-4 py-1 font-black text-sm uppercase tracking-tighter transform -rotate-1">
              INSTA-JSON VIEWER
            </div>
            <h1 className="text-4xl md:text-6xl font-black text-black leading-tight tracking-tighter uppercase italic">
              ARCHIVE <span className="underline decoration-4 text-[#ff90e8]">ACCESS.</span>
            </h1>
            <p className="text-lg font-bold text-gray-800">
              Drop your Instagram export JSON here to search and browse your archive with professional-grade clarity.
            </p>
          </div>

          <div 
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={`
              border-4 border-dashed border-black p-12 flex flex-col items-center justify-center space-y-4 cursor-pointer
              transition-all duration-200
              ${isDragging ? 'bg-[#05a35a] text-white' : 'bg-white hover:bg-[#ffda58]/10'}
            `}
            onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = '.json';
              input.multiple = true;
              input.onchange = (e) => handleFileUpload((e.target as HTMLInputElement).files);
              input.click();
            }}
          >
            <div className="bg-black p-4 border-2 border-black">
              <Upload className={`w-12 h-12 ${isDragging ? 'text-white' : 'text-[#ffda58]'}`} />
            </div>
            <div className="text-center">
              <span className="text-xl font-black uppercase block">Import Data</span>
              <span className="text-sm font-bold opacity-60">SELECT JSON FILE</span>
            </div>
          </div>

          <div className="bg-[#05a35a] text-white border-2 border-black p-4 flex gap-4 items-start shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <Info className="w-6 h-6 flex-shrink-0 mt-1" />
            <div className="text-sm font-bold">
              <strong className="block mb-1 underline uppercase">PRO TIP:</strong>
              Download your Instagram data in JSON format to use this tool. It's fast, private, and works offline once loaded.
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] h-[100dvh] flex flex-col bg-[#f4f4f0] font-sans border-0 md:border-[8px] border-black overflow-hidden relative">
      {/* Top Header - Optimized for Mobile */}
      <header className="h-16 md:h-20 bg-[#ffda58] border-b-4 border-black flex items-center gap-2 md:gap-4 px-3 md:px-6 flex-shrink-0 z-50">
        <div className="flex items-center gap-2 md:gap-4 flex-shrink-0">
          <button 
            onClick={() => setIsMenuOpen(true)}
            className="md:hidden bg-black text-white p-2.5 border-2 border-black active:bg-[#ff90e8] transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
          <button 
            onClick={() => setData(null)}
            className="hidden sm:block bg-black text-white p-2.5 border-2 border-black hover:bg-[#ff90e8] hover:text-black transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="logo font-black text-xl md:text-2xl uppercase tracking-tighter leading-none hidden lg:block">
            InstaArchive
          </div>
        </div>

        <div className="search-container flex-1 relative">
          <input 
            type="text" 
            placeholder="SEARCH..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-white border-3 border-black py-2 md:py-2.5 pl-3 md:pl-4 pr-10 font-bold text-xs md:text-sm outline-none shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] md:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] focus:translate-x-[1px] focus:translate-y-[1px] focus:shadow-none transition-all"
          />
          <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 opacity-100 font-black" />
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button 
            onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = '.json';
              input.multiple = true;
              input.onchange = (e) => handleFileUpload((e.target as HTMLInputElement).files);
              input.click();
            }}
            className="bg-black text-white p-2.5 border-2 border-black hover:bg-[#ff90e8] hover:text-black transition-colors"
            title="Import New JSON"
          >
            <Upload className="w-5 h-5" />
          </button>
          
          <button 
            onClick={handleShare}
            disabled={isSharing}
            className={`
              p-2.5 border-2 border-black transition-colors
              ${shareUrl ? 'bg-[#05a35a] text-white' : 'bg-white text-black hover:bg-[#ff90e8]'}
            `}
            title="Get Shareable Link"
          >
            <Share2 className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Sharing Notification Bar (Compact for Android) */}
      <AnimatePresence>
        {shareUrl && (
          <motion.div 
            initial={{ y: -50 }} animate={{ y: 0 }} exit={{ y: -50 }}
            className="bg-[#05a35a] text-white p-2 border-b-4 border-black flex items-center justify-between px-4 z-40"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Check className="w-4 h-4 flex-shrink-0" />
              <span className="text-[10px] md:text-xs font-black uppercase truncate">Link Ready!</span>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={copyToClipboard}
                className="bg-white text-black px-3 py-1 text-[10px] font-black uppercase border-2 border-black hover:invert"
              >
                {copying ? 'COPIED' : 'COPY'}
              </button>
              <button onClick={() => setShareUrl(null)} className="p-1"><X className="w-4 h-4" /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar - Desktop */}
        <aside className="w-72 border-r-4 border-black bg-white flex-col hidden md:flex overflow-hidden">
          <div className="p-4 bg-[#f4f4f0] border-b-2 border-black font-black text-xs uppercase tracking-widest text-[#555]">
            Conversation Data
          </div>
          <div className="flex-1 overflow-y-auto bg-white p-4 space-y-4">
             <div className="space-y-4">
              <div>
                <span className="block text-[10px] font-black uppercase text-gray-400 mb-2">View Profile As:</span>
                <div className="flex flex-col gap-2">
                  {data.participants.map((p, i) => (
                    <button 
                      key={i} 
                      onClick={() => setMeName(p.name)}
                      className={`
                        text-left border-2 border-black px-3 py-2 text-[10px] font-black uppercase transition-all
                        ${meName === p.name ? 'bg-[#ffda58] shadow-none translate-x-[1px] translate-y-[1px]' : 'bg-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-[#f4f4f0]'}
                      `}
                    >
                      {fixEncoding(p.name)} {meName === p.name && '✓'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="pt-2 border-t border-black/10">
                <span className="block text-[10px] font-black uppercase text-gray-400 mb-1">Total Payload</span>
                <p className="text-xs font-black uppercase">{data.messages.length} Records Found</p>
              </div>
            </div>
          </div>
        </aside>

        {/* View Area */}
        <main className="flex-1 flex flex-col bg-white relative overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4 md:p-8 dot-grid scroll-smooth">
            <div className="max-w-3xl mx-auto flex flex-col pb-32">
              {filteredMessages.length === 0 ? (
                <div className="bg-white border-4 border-black p-12 text-center shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] mt-20">
                  <p className="text-xl font-black uppercase">No results found.</p>
                </div>
              ) : (
                filteredMessages.map((msg, idx) => {
                  const isMe = msg.sender_name === meName;
                  const sender = fixEncoding(msg.sender_name);
                  const content = fixEncoding(msg.content);
                  const showTimestamp = idx === 0 || (filteredMessages[idx-1].timestamp_ms - msg.timestamp_ms > 3600000);

                  return (
                    <div key={idx}>
                      {showTimestamp && (
                        <div className="timestamp text-center text-[10px] font-black uppercase my-8 text-gray-500 tracking-widest bg-[#f4f4f0] inline-block mx-auto px-4 py-1 border border-black/10 self-center">
                          {formatDate(msg.timestamp_ms)}
                        </div>
                      )}
                      
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
                        className={`msg-group flex flex-col mb-4 ${isMe ? 'items-end' : 'items-start'}`}
                      >
                        {!isMe && <span className="text-[10px] font-black uppercase mb-1 ml-2 text-gray-400">{sender}</span>}
                        <div className={`
                          bubble border-2 md:border-3 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] md:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] 
                          p-3 md:p-4 max-w-[90%] md:max-w-[75%] text-sm md:text-base font-bold leading-relaxed transition-all
                          ${isMe ? 'bg-[#ff90e8] rounded-[16px_16px_0_16px]' : 'bg-white rounded-[0_16px_16px_16px]'}
                        `}>
                          {content && <p className="break-words whitespace-pre-wrap">{content}</p>}
                          {(msg.photos || []).map((photo, pIdx) => (
                            <div key={pIdx} className="mt-3 border-2 border-black bg-black overflow-hidden rounded-lg">
                              <img src={photo.uri} alt="" className="w-full h-auto" referrerPolicy="no-referrer"
                                onError={(e) => { (e.target as HTMLImageElement).src = `https://picsum.photos/seed/${idx}/600/400`; }}
                              />
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Quick Scroll Up Button - Android Style */}
          <button 
            onClick={() => document.querySelector('.flex-1.overflow-y-auto')?.scrollTo({ top: 0, behavior: 'smooth' })}
            className="fixed bottom-6 right-6 bg-black text-[#ffda58] p-4 border-2 border-black rounded-full shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] active:translate-x-1 active:translate-y-1 active:shadow-none transition-all z-40"
          >
            <ChevronUp className="w-6 h-6" />
          </button>
        </main>
      </div>

      {/* Mobile Perspective Menu (Drawer) */}
      <AnimatePresence>
        {isMenuOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setIsMenuOpen(false)}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100]"
            />
            <motion.div 
              initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }}
              className="fixed inset-y-0 left-0 w-[80%] max-w-sm bg-white border-r-4 border-black z-[101] flex flex-col"
            >
              <div className="p-6 bg-[#ffda58] border-b-4 border-black flex items-center justify-between">
                <span className="font-black uppercase tracking-tighter text-xl italic">SETTINGS</span>
                <button onClick={() => setIsMenuOpen(false)}><X className="w-6 h-6" /></button>
              </div>
              <div className="p-6 flex-1 overflow-y-auto space-y-6">
                <div>
                  <h3 className="font-black uppercase text-xs text-gray-400 mb-4 tracking-widest">Change Perspective</h3>
                  <div className="space-y-3">
                    {data.participants.map((p, i) => (
                      <button 
                        key={i} 
                        onClick={() => { setMeName(p.name); setIsMenuOpen(false); }}
                        className={`
                          w-full text-left border-3 border-black p-4 font-black uppercase text-sm flex items-center justify-between
                          ${meName === p.name ? 'bg-[#ff90e8] shadow-none translate-x-1 translate-y-1' : 'bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]'}
                        `}
                      >
                        {fixEncoding(p.name)}
                        {meName === p.name && <Check className="w-5 h-5" />}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="pt-6 border-t border-black/10">
                   <p className="text-[10px] font-black uppercase text-gray-400">Archival Statistics</p>
                   <p className="font-black text-xl uppercase mt-1">{data.messages.length} Messages</p>
                </div>
              </div>
              <div className="p-6 border-t-4 border-black bg-[#f4f4f0]">
                 <button 
                  onClick={() => setData(null)}
                  className="w-full bg-black text-white p-4 font-black uppercase tracking-widest border-2 border-black active:bg-[#ff90e8]"
                 >
                   EXIT SESSION
                 </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
