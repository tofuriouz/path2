import React, { useState, useMemo, useEffect } from 'react';
import { ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { studyGuide, allQuestions, Question, StreamItem } from './data';
import { cn } from './lib/utils';

type AppPhase = 'stream' | 'review' | 'global_cases' | 'global_review_cases' | 'complete';

export default function App() {
  const [moduleId, setModuleId] = useState<number>(() => {
    const saved = localStorage.getItem('oralpath_state_v1');
    if (saved) {
      try {
        return JSON.parse(saved).moduleId || 1;
      } catch (e) { return 1; }
    }
    return 1;
  });
  const [phase, setPhase] = useState<AppPhase>(() => {
    const saved = localStorage.getItem('oralpath_state_v1');
    if (saved) {
      try {
        return JSON.parse(saved).phase || 'stream';
      } catch (e) { return 'stream'; }
    }
    return 'stream';
  });
  const [flowIndex, setFlowIndex] = useState(() => {
    const saved = localStorage.getItem('oralpath_state_v1');
    if (saved) {
      try {
        return JSON.parse(saved).flowIndex || 0;
      } catch (e) { return 0; }
    }
    return 0;
  });
  const [reviewQueue, setReviewQueue] = useState<number[]>(() => {
    const saved = localStorage.getItem('oralpath_state_v1');
    if (saved) {
      try {
        return JSON.parse(saved).reviewQueue || [];
      } catch (e) { return []; }
    }
    return [];
  });
  const [isReviewing, setIsReviewing] = useState(() => {
    const saved = localStorage.getItem('oralpath_state_v1');
    if (saved) {
      try {
        return JSON.parse(saved).isReviewing || false;
      } catch (e) { return false; }
    }
    return false;
  });
  const [itemsSinceReview, setItemsSinceReview] = useState(() => {
    const saved = localStorage.getItem('oralpath_state_v1');
    if (saved) {
      try {
        return JSON.parse(saved).itemsSinceReview || 0;
      } catch (e) { return 0; }
    }
    return 0;
  });
  const [showTutorial, setShowTutorial] = useState(false);

  useEffect(() => {
    const hasSeen = localStorage.getItem('oralpath_tutorial_v1');
    if (!hasSeen) setShowTutorial(true);
  }, []);

  // Save state to localStorage whenever it changes
  useEffect(() => {
    const state = { moduleId, phase, flowIndex, reviewQueue, itemsSinceReview, isReviewing };
    localStorage.setItem('oralpath_state_v1', JSON.stringify(state));
  }, [moduleId, phase, flowIndex, reviewQueue, itemsSinceReview, isReviewing]);

  // Safety: Recover from inconsistent review state
  useEffect(() => {
    if (isReviewing && reviewQueue.length === 0) {
      setIsReviewing(false);
    }
  }, [isReviewing, reviewQueue]);

  const closeTutorial = () => {
    localStorage.setItem('oralpath_tutorial_v1', 'true');
    setShowTutorial(false);
  };

  const currentModule = useMemo(() => studyGuide.find(s => s.id === moduleId) || studyGuide[0], [moduleId]);

  // Filter stream into real content/quizzes
  const realStream = useMemo(() => currentModule.stream.filter(item => item.type !== 'case'), [currentModule]);
  
  // Collect ALL cases from ALL modules for the final phase
  const allCases = useMemo(() => {
    return studyGuide.flatMap(section => section.stream.filter(item => item.type === 'case'));
  }, []);

  // Compute the flow (4:4 structure)
  const flow = useMemo(() => {
    const items = phase === 'stream' ? realStream : allCases;
    const texts = items.filter(i => i.type === 'text');
    const quizzes = items.filter(i => i.type === 'quiz' || i.type === 'case');
    
    const result: { type: 'text_group' | 'quiz' | 'case', items: StreamItem[] }[] = [];
    let tIdx = 0;
    let qIdx = 0;
    
    while (tIdx < texts.length || qIdx < quizzes.length) {
      const textBatch = texts.slice(tIdx, tIdx + 4);
      if (textBatch.length > 0) {
        result.push({ type: 'text_group', items: textBatch });
        tIdx += 4;
      }
      
      const quizBatch = quizzes.slice(qIdx, qIdx + 4);
      for (const q of quizBatch) {
        result.push({ type: q.type as 'quiz' | 'case', items: [q] });
      }
      qIdx += 4;
    }
    return result;
  }, [phase, realStream, allCases]);

  const totalModules = studyGuide.length;
  
  // Progress calculation
  const progressPercent = useMemo(() => {
    if (phase === 'complete') return 100;
    
    const totalMainItems = studyGuide.reduce((acc, s) => acc + s.stream.filter(i => i.type !== 'case').length, 0);
    const totalCaseItems = allCases.length;
    const totalOverall = totalMainItems + totalCaseItems;

    let completedItems = 0;
    // Items from previous modules
    for (let i = 1; i < moduleId; i++) {
      const mod = studyGuide.find(s => s.id === i);
      if (mod) completedItems += mod.stream.filter(item => item.type !== 'case').length;
    }

    if (phase === 'stream' || phase === 'global_cases') {
      // Sum items in completed flow pages
      for (let i = 0; i < flowIndex; i++) {
        if (flow[i]) completedItems += flow[i].items.length;
      }
    } else if (phase === 'global_review_cases') {
      completedItems = totalMainItems + totalCaseItems;
    }

    return Math.round((completedItems / totalOverall) * 100);
  }, [phase, moduleId, flowIndex, flow, allCases.length]);

  const handleNextStreamItem = () => {
    const nextItemsSinceReview = itemsSinceReview + 1;
    
    if (isReviewing) {
      const shouldStopReview = reviewQueue.length === 0 || nextItemsSinceReview % 2 === 0;
      if (shouldStopReview) {
        setIsReviewing(false);
        setItemsSinceReview(0);
        // If we were at the end of the flow when we started review, transition now
        if (flowIndex >= flow.length - 1) {
          handleModuleTransition();
        }
      } else {
        setItemsSinceReview(nextItemsSinceReview);
      }
    } else {
      // We just finished a stream item
      if (nextItemsSinceReview >= 8 && reviewQueue.length > 0) {
        setIsReviewing(true);
        setItemsSinceReview(0);
        // Advance flowIndex so we don't repeat the item after review
        if (flowIndex < flow.length - 1) {
          setFlowIndex(prev => prev + 1);
        } else {
          // If we are at the end, we'll transition after review
        }
      } else {
        // Advance flow
        if (flowIndex < flow.length - 1) {
          setFlowIndex(prev => prev + 1);
          setItemsSinceReview(nextItemsSinceReview);
        } else {
          // End of flow
          if (reviewQueue.length > 0) {
            setIsReviewing(true);
            setItemsSinceReview(0);
          } else {
            handleModuleTransition();
          }
        }
      }
    }
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleModuleTransition = () => {
    if (moduleId < totalModules) {
      setModuleId(prev => prev + 1);
      setPhase('stream');
      setFlowIndex(0);
      setReviewQueue([]);
      setIsReviewing(false);
      setItemsSinceReview(0);
    } else {
      // All modules done, move to global cases
      if (phase === 'stream' && allCases.length > 0) {
        setPhase('global_cases');
        setFlowIndex(0);
        setReviewQueue([]);
        setIsReviewing(false);
        setItemsSinceReview(0);
      } else {
        setPhase('complete');
      }
    }
  };

  const handleQuizResult = (quality: 'incorrect' | 'guessed' | 'knew', qId: number) => {
    if ((quality === 'incorrect' || quality === 'guessed') && !reviewQueue.includes(qId)) {
      setReviewQueue(prev => [...prev, qId]);
    }
  };

  const handleReviewAnswer = (quality: 'again' | 'good') => {
    if (reviewQueue.length === 0) return;
    const currentId = reviewQueue[0];
    
    let newQueue = [...reviewQueue.slice(1)];
    if (quality === 'again') {
      newQueue.push(currentId);
    }
    setReviewQueue(newQueue);
    
    // After a review answer, we always trigger handleNextStreamItem to decide what's next
    handleNextStreamItem();
  };

  const currentItem = useMemo(() => {
    if (isReviewing) return null; // Handled by review block
    if (phase === 'stream' || phase === 'global_cases') return flow[flowIndex];
    return null;
  }, [phase, flowIndex, flow, isReviewing]);

  return (
    <div className="min-h-screen flex flex-col relative text-foreground selection:bg-accent selection:text-background bg-background">
      <div className="bg-noise" />

      {/* Global Progress Bar */}
      <div className="fixed top-0 left-0 w-full h-1.5 bg-muted z-50">
        <div 
          className="h-full bg-accent transition-all duration-500 ease-out"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Minimal Header */}
      <header className="fixed top-1.5 left-0 w-full z-40 bg-background/80 backdrop-blur-sm border-b border-border">
        <div className="max-w-3xl mx-auto px-6 h-12 flex items-center justify-between">
          <span className="font-mono font-bold text-xs tracking-widest text-foreground uppercase">
            {phase.startsWith('global') ? 'ORAL.PATH // GLOBAL_VALIDATION' : `ORAL.PATH // VOL_${String(moduleId).padStart(2, '0')}`}
          </span>
          <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
            {isReviewing ? 'DYNAMIC_SRS_INTERLEAVE' : (
              <>
                {phase === 'stream' && '01_INTEGRATED_FEED'}
                {phase === 'global_cases' && '03_GLOBAL_CASES'}
                {phase === 'complete' && 'STATUS_COMPLETE'}
              </>
            )}
          </span>
        </div>
      </header>

      {/* Tutorial Overlay */}
      <AnimatePresence>
        {showTutorial && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-background/95 backdrop-blur-md flex items-center justify-center p-4"
          >
            <div className="border border-border bg-background w-full max-w-xl relative p-8 md:p-12 shadow-2xl">
              <div className="absolute inset-0 bg-noise opacity-20 pointer-events-none" />
              <div className="relative z-10">
                <p className="font-mono text-accent uppercase tracking-[0.2em] text-[10px] mb-6">HOW TO STUDY</p>
                <h2 className="text-3xl md:text-4xl font-display font-bold tracking-tighter leading-none text-foreground mb-8">
                  THE LEARNING FEED
                </h2>
                <div className="w-full h-px bg-border mb-8" />
                
                <div className="space-y-6 mb-10">
                  <div>
                    <h3 className="font-mono text-xs text-foreground tracking-[0.1em] mb-1">[ READ & TEST ]</h3>
                    <p className="text-muted-foreground font-sans text-sm leading-relaxed">Read a few short lessons, then immediately answer questions to lock in what you've learned.</p>
                  </div>
                  <div>
                    <h3 className="font-mono text-xs text-accent tracking-[0.1em] mb-1">[ SMART REVIEW ]</h3>
                    <p className="text-muted-foreground font-sans text-sm leading-relaxed">If you miss a question or feel unsure, the app will bring it back later to make sure you've mastered it.</p>
                  </div>
                  <div>
                    <h3 className="font-mono text-xs text-foreground tracking-[0.1em] mb-1">[ FINAL PRACTICE ]</h3>
                    <p className="text-muted-foreground font-sans text-sm leading-relaxed">Once you finish all the lessons, you'll face real-world clinical cases to test your skills.</p>
                  </div>
                </div>

                <button 
                  onClick={closeTutorial}
                  className="w-full font-mono text-sm uppercase tracking-[0.2em] text-background bg-foreground hover:bg-accent hover:text-foreground py-4 transition-colors"
                >
                  [ ACKNOWLEDGE ]
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center pt-24 pb-16 px-4 md:px-8 w-full max-w-3xl mx-auto relative z-10">
        <AnimatePresence mode="wait">
          {(phase === 'stream' || phase === 'global_cases') && !isReviewing && currentItem && (
            <motion.div
              key={`${phase}-${phase === 'stream' ? moduleId : 'global'}-${flowIndex}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="w-full"
            >
              {currentItem.type === 'text_group' && (
                <div className="w-full">
                  <div className="space-y-12 mb-12">
                    {currentItem.items.map((item, idx) => (
                      <div key={item.id} className="markdown-content prose max-w-none">
                        <ReactMarkdown>{item.content || ''}</ReactMarkdown>
                        {idx < currentItem.items.length - 1 && <div className="h-px bg-border/50 mt-12" />}
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-border pt-8">
                    <button 
                      onClick={handleNextStreamItem}
                      className="font-mono text-sm uppercase tracking-[0.2em] text-foreground hover:text-accent transition-colors flex items-center gap-4"
                    >
                      [ CONTINUE TO QUESTIONS ] <ArrowRight size={16} />
                    </button>
                  </div>
                </div>
              )}

              {(currentItem.type === 'quiz' || currentItem.type === 'case') && currentItem.items[0].questionId && (
                <FeedQuiz 
                  q={allQuestions.find(q => q.id === currentItem.items[0].questionId)!} 
                  onNext={(quality) => {
                    handleQuizResult(quality, currentItem.items[0].questionId!);
                    handleNextStreamItem();
                  }} 
                  tag={currentItem.type === 'case' ? "GLOBAL_CASE" : "KNOWLEDGE_CHECK"}
                />
              )}
            </motion.div>
          )}

          {isReviewing && reviewQueue.length > 0 && (
            <motion.div
              key={`review-${reviewQueue[0]}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="w-full"
            >
              <FeedFlashcard 
                q={allQuestions.find(q => q.id === reviewQueue[0])!} 
                onAnswer={handleReviewAnswer}
                queueLength={reviewQueue.length}
              />
            </motion.div>
          )}

          {phase === 'complete' && (
            <motion.div
              key="complete"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="w-full flex flex-col justify-center py-20"
            >
              <h2 className="text-4xl md:text-5xl font-display font-bold tracking-tighter leading-none text-foreground mb-6">SYSTEM_CLEARED</h2>
              <p className="text-lg text-muted-foreground mb-12 max-w-2xl font-mono">All volumes and clinical validations complete. Mastery achieved.</p>
              
              <div className="flex flex-col sm:flex-row gap-6">
                <button 
                  onClick={() => {
                    localStorage.removeItem('oralpath_state_v1');
                    window.location.reload();
                  }}
                  className="font-mono text-sm uppercase tracking-[0.2em] text-background bg-foreground hover:bg-accent hover:text-foreground px-8 py-4 transition-colors"
                >
                  [ RESTART_PROTOCOL ]
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function FeedQuiz({ q, onNext, tag }: { q: Question, onNext: (quality: 'incorrect' | 'guessed' | 'knew') => void, tag: string }) {
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);

  // Randomize options
  const randomizedOptions = useMemo(() => {
    if (!q.options) return [];
    const optionsWithOriginalIndex = q.options.map((opt, idx) => ({ opt, originalIdx: idx }));
    return optionsWithOriginalIndex.sort(() => Math.random() - 0.5);
  }, [q.id, q.options]);

  const handleOptionClick = (index: number) => {
    if (showResult) return;
    setSelectedOption(index);
    setShowResult(true);
  };

  const isCorrect = useMemo(() => {
    if (selectedOption === null) return false;
    return randomizedOptions[selectedOption].originalIdx === q.correctIndex;
  }, [selectedOption, randomizedOptions, q.correctIndex]);

  return (
    <div className="w-full">
      <div className="mb-10">
        <span className="font-mono text-muted-foreground text-[10px] uppercase tracking-[0.2em] mb-4 block">
          {tag} // ID_{String(q.id).padStart(4, '0')}
        </span>
        <h3 className="text-2xl md:text-3xl lg:text-4xl font-display font-bold tracking-tighter leading-tight text-foreground">
          {q.question}
        </h3>
      </div>

      <div className="border-t border-border flex flex-col">
        {randomizedOptions.map((item, idx) => {
          const isSelected = selectedOption === idx;
          const isCorrectOption = item.originalIdx === q.correctIndex;
          
          let variant = "default";
          if (showResult) {
            if (isCorrectOption) variant = "correct";
            else if (isSelected) variant = "incorrect";
            else variant = "dimmed";
          } else if (isSelected) {
            variant = "selected";
          }

          return (
            <button
              key={idx}
              disabled={showResult}
              onClick={() => handleOptionClick(idx)}
              className={cn(
                "w-full text-left p-4 md:p-5 border-b border-border transition-colors flex items-start gap-4 group font-mono text-sm md:text-base",
                variant === "default" && "hover:bg-muted text-muted-foreground hover:text-foreground",
                variant === "selected" && "bg-muted text-foreground border-l-2 border-l-foreground",
                variant === "correct" && "bg-emerald-500/10 text-emerald-500 border-l-2 border-l-emerald-500",
                variant === "incorrect" && "bg-accent/10 text-accent border-l-2 border-l-accent line-through opacity-80",
                variant === "dimmed" && "text-muted-foreground opacity-30"
              )}
            >
              <span className="flex-shrink-0 mt-0.5">[{String.fromCharCode(65 + idx)}]</span>
              <span className="font-medium tracking-tight font-sans">{item.opt}</span>
            </button>
          );
        })}
      </div>

      <AnimatePresence>
        {showResult && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="pt-8 mt-8 border-t border-border border-dashed">
              <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-[0.2em] mb-4">ORAL.LOG // EXPLANATION</p>
              <p className="text-foreground text-lg md:text-xl leading-relaxed max-w-3xl mb-10 font-display tracking-tight">
                {q.explanation}
              </p>

              {isCorrect ? (
                <div className="flex flex-col sm:flex-row gap-6">
                  <button 
                    onClick={() => onNext('knew')}
                    className="font-mono text-sm uppercase tracking-[0.2em] text-background bg-foreground hover:bg-accent hover:text-foreground px-8 py-4 transition-colors"
                  >
                    [ KNEW IT ]
                  </button>
                  <button 
                    onClick={() => onNext('guessed')}
                    className="font-mono text-sm uppercase tracking-[0.2em] text-foreground border border-foreground hover:border-accent hover:text-accent px-8 py-4 transition-colors"
                  >
                    [ GUESSED ]
                  </button>
                </div>
              ) : (
                <button 
                  onClick={() => onNext('incorrect')}
                  className="font-mono text-sm uppercase tracking-[0.2em] text-foreground hover:text-accent transition-colors flex items-center gap-4"
                >
                  [ CONTINUE ] <ArrowRight size={16} />
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FeedFlashcard({ q, onAnswer, queueLength }: { q: Question, onAnswer: (quality: 'again' | 'good') => void, queueLength: number }) {
  const [isFlipped, setIsFlipped] = useState(false);

  useEffect(() => {
    setIsFlipped(false);
  }, [q.id]);

  return (
    <div className="w-full">
      <div className="mb-10 flex justify-between items-end">
        <span className="font-mono text-accent text-[10px] uppercase tracking-[0.2em] block">
          ORAL.MEM // ID_{String(q.id).padStart(4, '0')}
        </span>
        <span className="font-mono text-accent text-[10px] uppercase tracking-[0.2em] block">
          QUEUE: {queueLength}
        </span>
      </div>

      {!isFlipped ? (
        <div className="py-8">
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-display font-bold tracking-tighter leading-tight mb-16 text-foreground">
            {q.question}
          </h2>
          <button 
            onClick={() => setIsFlipped(true)}
            className="font-mono text-sm uppercase tracking-[0.2em] text-foreground hover:text-accent transition-colors"
          >
            [ REVEAL_ANSWER ]
          </button>
        </div>
      ) : (
        <div className="py-8">
          <p className="text-sm text-muted-foreground mb-8 font-mono tracking-tight border-l border-border pl-4">
            {q.question}
          </p>
          <h2 className="text-3xl md:text-4xl font-display font-bold tracking-tighter leading-tight mb-8 text-foreground">
            {q.answer}
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl leading-relaxed mb-16 font-display tracking-tight">
            {q.explanation}
          </p>
          
          <div className="flex gap-8">
            <button 
              onClick={() => onAnswer('again')} 
              className="font-mono text-sm uppercase tracking-[0.2em] text-accent hover:text-foreground transition-colors"
            >
              [ AGAIN ]
            </button>
            <button 
              onClick={() => onAnswer('good')} 
              className="font-mono text-sm uppercase tracking-[0.2em] text-emerald-500 hover:text-foreground transition-colors"
            >
              [ GOOD ]
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
