import { memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Dimensions, Easing, Keyboard, Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { MotionModal as Modal } from './motion-modal';
import { AnimatedView, Pressable, ScrollView, Text, View } from '../theme/primitives';
import { useReducedMotion } from './use-reduced-motion';
import { QuestionPageActivity } from './question-page-activity';
import { QuestionPageReady, QuestionPageRequested, useQuestionPageReady } from './question-page-ready';
import { createPageMemory, PageMemory } from './page-memory';
import { Button, colors, layout, s } from './ui';
import { useTheme } from '../theme/provider';
import { themeColors } from '../theme/palette';

import type { QuestionAnswerState } from '@solveflow/contracts/http';
import type { QuestionOverviewItem } from '@solveflow/client/presentation';
import { questionOverviewLabel, questionStatusColors, questionStatusLabel } from './question-status';

type PageTransition = { from: string; to: string; direction: number; phase: 'waiting' | 'moving'; progress: Animated.Value };

type AxisThread = { key: string; number?: number };
// Readiness and slide updates should not rebuild every tab in a large batch.
// Only the old/new selected group, a width change or changed threads need work.
const QuestionTabGroup = memo(function QuestionTabGroup({ group, page, width, selected, numbered, onSelect, states, overviews }: {
  group: readonly AxisThread[]; page: number; width: number; selected: string | null; numbered: boolean; onSelect: (key: string) => void;
  states?: ReadonlyMap<string, QuestionAnswerState> | undefined;
  overviews?: ReadonlyMap<string, QuestionOverviewItem> | undefined;
}) {
  const { scheme } = useTheme();
  const palette = themeColors[scheme];
  return <View style={[styles.axisPage, { width }]}>
    {group.map((thread, offsetIndex) => {
      const isTabSelected = selected === thread.key;
      const overview = overviews?.get(thread.key);
      const state = overview?.state ?? states?.get(thread.key);
      const toneKey = overview?.tone ?? state;
      const tone = toneKey ? questionStatusColors[scheme][toneKey] : null;
      const fallback = `${page * 4 + offsetIndex + 1}`;
      const baseNum = thread.number === undefined ? (numbered ? '补充' : fallback) : `${thread.number}`;
      const compactAnswer = overview?.answer && !overview.excerpt && overview.answer.length <= 6 && thread.number !== undefined ? overview.answer : null;
      const hintParts = [overview ? overview.phaseLabel : state ? questionStatusLabel[state] : '', overview?.answer ? `答案 ${overview.answer}` : ''].filter(Boolean);
      return <Pressable key={thread.key} hitSlop={{ top: 4, bottom: 4 }} accessibilityRole="tab"
        accessibilityLabel={thread.number === undefined ? (numbered ? '补充记录' : `题目 ${fallback}`) : `跳转第${thread.number}题`}
        accessibilityHint={hintParts.length ? hintParts.join('，') : undefined}
        accessibilityState={{ selected: isTabSelected }} aria-selected={isTabSelected}
        onPress={() => { Keyboard.dismiss(); onSelect(thread.key); }} style={[styles.tab, tone && { backgroundColor: tone.backgroundColor }, isTabSelected && { borderWidth: 2, borderColor: palette.accent }, !tone && isTabSelected && { backgroundColor: palette.soft, borderRadius: 10 }]}>
        <Text numberOfLines={1} style={[styles.tabText, { color: tone?.color ?? palette.muted }, isTabSelected && { fontWeight: '700', color: tone?.color ?? palette.accent }]}>{compactAnswer ? `${baseNum} · ${compactAnswer}` : baseNum}</Text>
      </Pressable>;
    })}
  </View>;
});

function PagerArrow({ previous = false }: { previous?: boolean }) {
  const { scheme } = useTheme();
  return (
    <View
      accessible={false}
      style={{
        width: 9,
        height: 9,
        borderTopWidth: 1.8,
        borderRightWidth: 1.8,
        borderColor: themeColors[scheme].accent,
        transform: [{ rotate: previous ? '-135deg' : '45deg' }],
        marginLeft: previous ? 4 : -4,
      }}
    />
  );
}

export function QuestionPager<T extends { key: string; number?: number }>({
  threads,
  selected,
  onSelect,
  render,
  retainPages = true,
  scrollPages = true,
  showNavigation = threads.length > 1,
  jumpGridTrigger,
  states,
  overviews,
}: {
  retainPages?: boolean;
  scrollPages?: boolean;
  showNavigation?: boolean;
  threads: T[];
  selected: string;
  onSelect: (key: string) => void;
  render: (thread: T, onSwipe: (direction: number) => Promise<void>) => ReactNode;
  jumpGridTrigger?: number | undefined;
  states?: ReadonlyMap<string, QuestionAnswerState> | undefined;
  overviews?: ReadonlyMap<string, QuestionOverviewItem> | undefined;
}) {
  const { scheme } = useTheme();
  const palette = themeColors[scheme];
  const bg = palette.background;
  const [gridOpen, setGridOpen] = useState(false);
  const [containerWidth, setContainerWidth] = useState(() => Dimensions.get('window').width || 390);
  const reduced = useReducedMotion();

  const parentActive = useContext(QuestionPageActivity);
  const parentMemory = useContext(PageMemory);
  const [ownMemory] = useState(createPageMemory);
  const memory = parentMemory ?? ownMemory;
  const numbered = useMemo(() => threads.filter(thread => thread.number !== undefined), [threads]);
  const pages = numbered.length ? numbered : threads;
  const countWidth = pages.length >= 100 ? 52 : 32;

  const parentRequested = useContext(QuestionPageRequested);
  const [settledKey, setSettledKey] = useState(selected);
  const [transition, setTransition] = useState<PageTransition | null>(null);
  const [readyKeys, setReadyKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [preloaded, setPreloaded] = useState<ReadonlySet<string>>(() => new Set());
  const prevTrigger = useRef(jumpGridTrigger);
  const activeKey = transition?.phase === 'moving' ? transition.to : settledKey;
  const outgoingKey = transition?.phase === 'moving' ? transition.from : null;
  const direction = transition?.direction ?? 1;
  const progress = transition?.progress;
  const reportReady = useCallback((key: string, ready: boolean) => {
    setReadyKeys(previous => {
      if (previous.has(key) === ready) return previous;
      const next = new Set(previous); if (ready) next.add(key); else next.delete(key);
      return next;
    });
  }, []);
  useQuestionPageReady(readyKeys.has(activeKey));

  // Finish the in-flight load/slide; repeated taps must not starve cold pages by
  // unmounting them before they can paint. selected keeps the latest destination.
  if (!transition && selected !== settledKey) {
    const from = pages.findIndex(thread => thread.key === settledKey);
    const to = pages.findIndex(thread => thread.key === selected);
    setTransition({ from: settledKey, to: selected, direction: from >= 0 && to >= 0 && to < from ? -1 : 1, phase: 'waiting', progress: new Animated.Value(0) });
  } else if (transition?.phase === 'waiting' && selected === settledKey) {
    setTransition(null);
  }

  useLayoutEffect(() => {
    if (transition?.phase !== 'waiting' || !readyKeys.has(transition.to)) return;
    setTransition({ ...transition, phase: 'moving' });
  }, [transition, readyKeys]);

  useLayoutEffect(() => {
    if (transition?.phase !== 'moving') return;
    let finished = false;
    const finish = () => { if (finished) return; finished = true; transition.progress.setValue(1); setSettledKey(transition.to); setTransition(null); };
    if (reduced) { finish(); return; }
    const animation = Animated.timing(transition.progress, {
      toValue: 1, duration: 240, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: true,
    });
    animation.start(({ finished }) => { if (finished) finish(); });
    // RN Web timing uses wall time. A clock rollback must not strand the pages
    // offscreen; timers still provide a bounded completion path after readiness.
    const deadline = setTimeout(() => { animation.stop(); finish(); }, 400);
    return () => { finished = true; clearTimeout(deadline); animation.stop(); };
  }, [transition, reduced]);

  useEffect(() => {
    if (jumpGridTrigger !== undefined && jumpGridTrigger !== prevTrigger.current) {
      prevTrigger.current = jumpGridTrigger;
      if (pages.length > 1) {
        setGridOpen(true);
      }
    }
  }, [jumpGridTrigger, pages.length]);

  const axisThreads = useMemo(() => numbered.length ? [...numbered, ...threads.filter(thread => thread.number === undefined)] : threads, [numbered, threads]);
  const index = pages.findIndex(thread => thread.key === activeKey);

  const axis = useRef<ScrollView>(null);
  const [axisWidth, setAxisWidth] = useState(0);
  const axisPage = Math.floor(Math.max(0, axisThreads.findIndex(thread => thread.key === activeKey)) / 4);
  const axisPages = useMemo(() => Array.from({ length: Math.ceil(axisThreads.length / 4) }, (_, page) => axisThreads.slice(page * 4, page * 4 + 4)), [axisThreads]);

  useEffect(() => {
    if (axisWidth) axis.current?.scrollTo({ x: axisPage * axisWidth, animated: !reduced });
  }, [activeKey, axisPage, axisWidth, reduced]);

  // Never accumulate WebViews as the reader visits more photos. Warm only the
  // immediate neighbours, after the transition has finished.
  const neighbours = [pages[index - 1]?.key, pages[index + 1]?.key];
  useEffect(() => {
    if (!retainPages || transition || !parentRequested) return;
    const timer = setTimeout(() => {
      setPreloaded(new Set([pages[index - 1]?.key, pages[index + 1]?.key].filter((key): key is string => !!key)));
    }, 80);
    return () => clearTimeout(timer);
  }, [index, pages, retainPages, transition, parentRequested]);

  const requestedIndex = pages.findIndex(thread => thread.key === selected);
  const lastMove = useRef(0);

  function choose(next: number) {
    const thread = pages[next];
    if (!thread || thread.key === selected) return;
    Keyboard.dismiss();
    onSelect(thread.key);
  }

  async function swipe(delta: number) {
    if (index < 0 || (delta !== -1 && delta !== 1) || Date.now() - lastMove.current < 300) return;
    lastMove.current = Date.now();
    choose(requestedIndex + delta);
  }

  return (
    <PageMemory value={memory}><View
      style={[styles.root, { backgroundColor: bg }]}
      onLayout={event => setContainerWidth(event.nativeEvent.layout.width || Dimensions.get('window').width || 390)}
    >
      {showNavigation && (
        <View testID="question-pager-navigation" style={[styles.navigation, { backgroundColor: bg, borderBottomColor: palette.line }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="上一道题"
            disabled={requestedIndex <= 0}
            accessibilityState={{ disabled: requestedIndex <= 0 }}
            onPress={() => choose(requestedIndex - 1)}
            style={[styles.arrow, requestedIndex <= 0 && styles.disabled]}
          >
            <PagerArrow previous />
          </Pressable>
          <ScrollView
            ref={axis}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            style={[styles.track, { backgroundColor: scheme === 'dark' ? '#1c2738' : '#f5f7fb' }]}
            onLayout={event => setAxisWidth(event.nativeEvent.layout.width)}
            contentContainerStyle={styles.axis}
            accessibilityLabel="题号导航"
          >
            {axisPages.map((group, page) => (
              <QuestionTabGroup states={states} overviews={overviews} key={page} group={group} page={page} width={axisWidth}
                selected={group.some(thread => thread.key === selected) ? selected : null}
                numbered={numbered.length > 0} onSelect={onSelect} />
            ))}
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={index < 0 ? '题号导航' : `当前第${index + 1}题，共${pages.length}题，展开题号速选`}
            onPress={() => { if (pages.length > 1) setGridOpen(true); }}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            style={({ pressed }) => [styles.countButton, { minWidth: countWidth }, pressed && pages.length > 1 && { opacity: 0.6 }]}
          >
            <Text accessibilityLiveRegion="polite" numberOfLines={1} style={[styles.count, { width: countWidth, color: palette.muted }]}>{index < 0 ? '记录' : `${index + 1}/${pages.length}`}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="下一道题"
            disabled={requestedIndex < 0 || requestedIndex >= pages.length - 1}
            accessibilityState={{ disabled: requestedIndex < 0 || requestedIndex >= pages.length - 1 }}
            onPress={() => choose(requestedIndex + 1)}
            style={[styles.arrow, (requestedIndex < 0 || requestedIndex >= pages.length - 1) && styles.disabled]}
          >
            <PagerArrow />
          </Pressable>
        </View>
      )}
      <View
        style={styles.stage}
        accessibilityState={{ busy: transition?.phase === 'waiting' }}
        onLayout={event => {
          const w = event.nativeEvent.layout.width;
          if (w > 0 && w !== containerWidth) setContainerWidth(w);
        }}
      >
        {threads.map(thread => {
          const isActive = thread.key === activeKey;
          const isOutgoing = thread.key === outgoingKey;
          const isTarget = thread.key === transition?.to;
          const shouldRender = (retainPages && preloaded.has(thread.key) && neighbours.includes(thread.key)) || isActive || isOutgoing || isTarget;
          if (!shouldRender) return null;

          let pageStyle: StyleProp<ViewStyle>;
          if (isActive) {
            pageStyle = [
              styles.page,
              { backgroundColor: bg, zIndex: Platform.OS === 'android' ? 0 : 2, opacity: 1 },
              outgoingKey && progress && !reduced
                ? {
                    transform: [
                      {
                        translateX: progress.interpolate({
                          inputRange: [0, 1],
                          extrapolate: 'clamp',
                          outputRange: [direction * containerWidth, 0],
                        }),
                      },
                    ],
                  }
                : undefined,
            ];
          } else if (isOutgoing) {
            pageStyle = [
              styles.page,
              {
                backgroundColor: bg,
                zIndex: Platform.OS === 'android' ? 0 : 1,
                opacity: 1,
                pointerEvents: 'none',
                transform: progress && !reduced
                  ? [
                      {
                        translateX: progress.interpolate({
                          inputRange: [0, 1],
                          extrapolate: 'clamp',
                          outputRange: [0, -direction * containerWidth],
                        }),
                      },
                    ]
                  : [],
              },
            ];
          } else {
            pageStyle = [
              styles.page,
              {
                backgroundColor: bg,
                zIndex: 0,
                opacity: Platform.OS === 'android' ? 0 : 1,
                pointerEvents: 'none',
                // Keep a full-size surface behind the current page so WebView can paint.
                transform: [{ translateX: 0 }],
              },
            ];
          }

          return (
            <AnimatedView
              key={thread.key}
              testID={`question-page-${thread.number ?? 'record'}`}
              aria-hidden={!isActive || !parentActive}
              {...(Platform.OS === 'web' ? { inert: !isActive || !parentActive } : {})}
              accessibilityElementsHidden={!isActive}
              importantForAccessibility={isActive ? 'auto' : 'no-hide-descendants'}
              // Keep Android's native child order fixed when selecting a page.
              // Noninteractive neighbours keep their layout but are transparent.
              style={pageStyle}
            >
              <QuestionPageReady pageKey={thread.key} onReady={reportReady}>
              <QuestionPageRequested value={parentRequested && (isActive || isTarget)}>
              <QuestionPageActivity value={parentActive && isActive}>
                {scrollPages ? (
                  <ScrollView testID="question-reading-scroll" keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content} contentOffset={{ x: 0, y: memory.scroll.get(thread.key) ?? 0 }} scrollEventThrottle={100} onScroll={event => memory.scroll.set(thread.key, event.nativeEvent.contentOffset.y)}>
                    {render(thread, isActive ? swipe : async () => {})}
                  </ScrollView>
                ) : (
                  render(thread, isActive ? swipe : async () => {})
                )}
              </QuestionPageActivity>
              </QuestionPageRequested>
              </QuestionPageReady>
            </AnimatedView>
          );
        })}
      </View>
      {gridOpen && (() => {
        const overviewItems = pages.map(thread => overviews?.get(thread.key));
        const answeredCount = overviewItems.filter(item => !!item?.answer).length;
        const verifiedCount = pages.filter(thread => (overviews?.get(thread.key)?.tone ?? states?.get(thread.key)) === 'verified').length;
        const pendingCount = pages.filter(thread => (overviews?.get(thread.key)?.tone ?? states?.get(thread.key)) === 'answered').length;
        const alertCount = pages.filter(thread => (overviews?.get(thread.key)?.tone ?? states?.get(thread.key)) === 'failed').length;
        const summaryStats = overviews
          ? [`已有答案 ${answeredCount}`, `通过 ${verifiedCount}`, ...(pendingCount ? [`待核验 ${pendingCount}`] : []), ...(alertCount ? [`待处理 ${alertCount}`] : [])]
          : [];
        return (
          <Modal visible={gridOpen} transparent animationType="fade" onRequestClose={() => setGridOpen(false)}>
            <Pressable accessibilityLabel="关闭题号面板" style={{ flex: 1, backgroundColor: '#00000066', justifyContent: 'flex-end' }} onPress={() => setGridOpen(false)}>
              <Pressable style={{ width: '100%', maxWidth: layout.workspaceWidth, alignSelf: 'center', backgroundColor: palette.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 14, maxHeight: '78%' }} onPress={e => e.stopPropagation()}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text style={s.label}>全部题目</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                      <Text style={[s.subtitle, { fontSize: 12 }]}>共 {pages.length} 题</Text>
                      {summaryStats.length > 0 && <Text style={[s.subtitle, { fontSize: 12 }]}>{summaryStats.join(' · ')}</Text>}
                    </View>
                  </View>
                  <Button title="关闭" compact secondary onPress={() => setGridOpen(false)} />
                </View>
                {(overviews || states) && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                    {(overviews
                      ? (['verified', 'answered', 'processing', 'failed', 'unanswered'] as const)
                      : (['verified', 'answered', 'failed', 'unanswered'] as const)
                    ).map(toneKey => (
                      <Text key={toneKey} style={{ fontSize: 12, color: questionStatusColors[scheme][toneKey].color }}>
                        ● {overviews ? questionOverviewLabel[toneKey] : questionStatusLabel[toneKey as QuestionAnswerState]}
                      </Text>
                    ))}
                  </View>
                )}
                <ScrollView contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 4 }}>
                  {pages.map((thread, idx) => {
                    const isSelectedTab = thread.key === activeKey;
                    const overview = overviews?.get(thread.key);
                    const state = overview?.state ?? states?.get(thread.key);
                    const toneKey = overview?.tone ?? state;
                    const tone = toneKey ? questionStatusColors[scheme][toneKey] : null;
                    const displayNum = thread.number ?? idx + 1;
                    const hintParts = [overview ? overview.phaseLabel : state ? questionStatusLabel[state] : '', overview?.answer ? `答案 ${overview.answer}` : ''].filter(Boolean);
                    return (
                      <Pressable
                        key={thread.key}
                        accessibilityRole="button"
                        accessibilityLabel={`快速跳转第${displayNum}题`}
                        accessibilityHint={hintParts.length ? hintParts.join('，') : undefined}
                        testID={`question-status-${displayNum}`}
                        onPress={() => { setGridOpen(false); choose(idx); }}
                        style={({ pressed }) => [{
                          minWidth: overviews ? 74 : 52,
                          ...(overviews ? { flexBasis: '22%', flexGrow: 1, maxWidth: 118, minHeight: 70, paddingHorizontal: 6, paddingVertical: 6, gap: 2 } : { width: 52, height: 48 }),
                          borderRadius: 12,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: tone?.backgroundColor ?? (pressed ? palette.soft : scheme === 'dark' ? '#243044' : '#f5f7fb'),
                          borderWidth: isSelectedTab ? 2 : 1,
                          borderColor: isSelectedTab ? palette.accent : palette.line,
                        }]}
                      >
                        <Text style={{ fontSize: overviews ? 13 : 16, lineHeight: overviews ? 17 : 22, fontWeight: isSelectedTab ? '700' : '600', fontVariant: ['tabular-nums'], color: tone?.color ?? palette.ink }}>
                          {displayNum}
                        </Text>
                        {overviews && overview?.answer ? (
                          <Text
                            numberOfLines={overview.excerpt ? 2 : 1}
                            style={{
                              width: '100%',
                              textAlign: 'center',
                              fontSize: overview.excerpt ? 11 : 14,
                              lineHeight: overview.excerpt ? 14 : 18,
                              fontWeight: overview.excerpt ? '400' : '700',
                              color: tone?.color ?? palette.ink,
                            }}
                          >
                            {overview.answer}
                          </Text>
                        ) : null}
                        {overviews ? (
                          <Text numberOfLines={1} style={{ fontSize: 11, lineHeight: 14, color: tone?.color ?? palette.muted, opacity: 0.9 }}>
                            {overview?.phaseLabel ?? '未答'}
                          </Text>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </Pressable>
            </Pressable>
          </Modal>
        );
      })()}
    </View></PageMemory>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, width: '100%', height: '100%', overflow: 'hidden' },
  stage: { flex: 1, width: '100%', position: 'relative', overflow: 'hidden' },
  page: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' },
  navigation: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingBottom: 8, width: '100%', maxWidth: layout.workspaceWidth, alignSelf: 'center', borderBottomWidth: 1, borderBottomColor: colors.line },
  track: { flex: 1, height: 44, backgroundColor: '#f5f7fb', borderRadius: 14 },
  axis: { height: 44 },
  axisPage: { flexDirection: 'row', flexShrink: 0, gap: 4, height: 44, alignItems: 'center', paddingHorizontal: 4 },
  // Reserve the selection border so flex items do not change width on selection.
  tab: { flex: 1, minWidth: 0, height: 36, borderWidth: 2, borderColor: 'transparent', borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 0 },
  selected: { backgroundColor: '#edf3ff', borderRadius: 10 },
  tabText: { fontSize: 15, lineHeight: 22, includeFontPadding: false, color: colors.muted, fontVariant: ['tabular-nums'] },
  selectedText: { color: colors.blue, fontWeight: '700' },
  arrow: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: .3 },
  countButton: { minWidth: 32, alignItems: 'center', justifyContent: 'center' },
  count: { width: 32, fontSize: 12, lineHeight: 18, includeFontPadding: false, textAlign: 'center', color: colors.muted, fontVariant: ['tabular-nums'] },
  content: { padding: 10, paddingBottom: 20, gap: 10, width: '100%', maxWidth: layout.workspaceWidth, alignSelf: 'center' },
});
