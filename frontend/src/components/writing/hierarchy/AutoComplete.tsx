"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Modal } from "@heroui/react";
import { apiGet } from "@/lib/api";
import { hierarchyNode, type EntityChoices, type HierarchyNode, type HierarchyRecord } from "@/types/hierarchy";
import HierarchyGeneration from "./HierarchyGeneration";

/** 编排阶段。 */
type AutoPhase = "scenes" | "plans";

export interface AutoCompleteProps {
  /** 起始篇章：AI 生成场景所在的节点。 */
  arc: HierarchyNode;
  volume: HierarchyNode;
  choices: EntityChoices;
  choicesError?: string;
  onClose: () => void;
  /** 生成页显隐：自动流程跑起来后要占满工作区，不能和目录各占一半。 */
  onGenerationPageChange?: (visible: boolean) => void;
  /** 场景保存后刷新目录。 */
  onScenesSaved: (records: HierarchyRecord[]) => void;
  /**
   * 两个阶段都完成后调用：回传本篇章节点、本次新建的场景与新章节，
   * 由调用方打开逐章写作（arc 范围，预选本章新建章节），停在“开始生成”前等作者确认模型配置。
   */
  onPlansReady: (arc: HierarchyNode, scenes: HierarchyNode[], chapterIds: string[]) => void;
}

/**
 * 功能：从「AI 生成场景」一键串联到章计划，减少逐次人工确认。
 * Args: props 起始篇章、实体选项与阶段回调。
 * Returns: 任一时刻只有一个生成弹窗，另加一次性的结束提示。
 *
 * 只做两件不接管写入的事：
 *   1. 对篇章触发场景生成，复用 autoRun/autoConfirm 自动生成并自动确认；
 *   2. 对每个新场景触发章计划生成，同样自动完成。
 * 写入仍走 HierarchyGeneration 原有的确认接口、幂等键与回执机制。
 * 逐章写作不在此处启动，交给调用方打开既有逐章写作，由作者确认模型配置后开始。
 */
export default function AutoComplete(props: AutoCompleteProps) {
  const { arc, volume, choices, choicesError, onClose, onScenesSaved, onPlansReady, onGenerationPageChange } = props;
  const t = useTranslations("writing.hierarchy");

  const [phase, setPhase] = useState<AutoPhase>("scenes");
  const [queue, setQueue] = useState<HierarchyNode[]>([]);
  const [index, setIndex] = useState(0);
  /** 无法继续时的说明；非空即收起生成弹窗，只留这条提示。 */
  const [notice, setNotice] = useState("");

  /** 用户中止后置位，阻止后续阶段继续推进。 */
  const stopped = useRef(false);
  /** 已交付结果、正在切换下一步的节点；它的 onClose 属于正常收尾，不是中止。 */
  const settled = useRef<string | null>(null);
  /** 各场景产出的章节，全部完成后一次性交出。 */
  const chapters = useRef<HierarchyRecord[]>([]);

  /** 功能：把一批场景接过章计划阶段。Args: scenes 场景记录。Returns: 无；空列表不改变阶段。 */
  const startPlans = useCallback((scenes: HierarchyRecord[]) => {
    if (!scenes.length) return false;
    setQueue(scenes.map((record) => hierarchyNode("scene", record)));
    setIndex(0);
    setPhase("plans");
    return true;
  }, []);

  /** 场景阶段完成，转入章计划阶段。 */
  const handleScenesSaved = useCallback((records: HierarchyRecord[]) => {
    settled.current = arc.id;
    if (stopped.current) return;
    const scenes = records.filter((record) => record.scene_id && !record.is_deleted);
    onScenesSaved(records);
    if (startPlans(scenes)) return;
    // 本次没有新场景：篇章通常已有场景，只是还没排章计划。
    // 回退到现有场景里缺章节的那些，继续补计划；全都有章节才收尾。
    void (async () => {
      try {
        const listed = await apiGet<{ data: HierarchyRecord[] }>(`/api/scenes/arc/${arc.id}`);
        if (stopped.current) return;
        const existing = listed.data.filter((record) => !record.is_deleted);
        // 只补真正缺章节的场景，已有正文计划的场景不重排。
        const counts = await Promise.all(existing.map(async (record) => {
          const chapters = await apiGet<{ data: HierarchyRecord[] }>(`/api/chapters/scene/${record.scene_id}`);
          return chapters.data.some((chapter) => !chapter.is_deleted);
        }));
        if (stopped.current) return;
        const pending = existing.filter((_, index) => !counts[index]);
        if (startPlans(pending)) return;
        setNotice(t(existing.length ? "autoComplete.allPlanned" : "autoComplete.noScenes"));
      } catch (failure) {
        if (!stopped.current) setNotice(failure instanceof Error ? failure.message : t("autoComplete.noScenes"));
      }
    })();
  }, [arc.id, onScenesSaved, startPlans, t]);

  /** 单场景章计划完成，推进到下一个场景或收尾。 */
  const handlePlanSaved = useCallback((records: HierarchyRecord[], scene: HierarchyNode) => {
    settled.current = scene.id;
    if (stopped.current) return;
    const saved = records.filter((record) => record.chapter_id && !record.is_deleted);
    chapters.current = [...chapters.current, ...saved];
    const next = index + 1;
    if (next < queue.length) {
      setIndex(next);
      return;
    }
    // 两个阶段都完成：回传篇章、新建场景与全部章节，交给逐章写作
    onPlansReady(arc, queue, chapters.current.map((record) => record.chapter_id!));
  }, [arc, index, onPlansReady, queue]);

  const currentScene = phase === "plans" ? queue[index] : undefined;

  // 组件卸载时停止推进，避免离开后仍在跑自动化。
  useEffect(() => () => { stopped.current = true; }, []);

  // 回退读取现有场景期间不留空白：沿用生成弹窗，等目录读完再切阶段。
  if (notice) return (
    <Modal.Backdrop isOpen onOpenChange={(open) => { if (!open) onClose(); }}>
      <Modal.Container size="lg" scroll="inside" className="p-0 sm:p-4">
        <Modal.Dialog className="sm:max-w-lg">
          <Modal.Header className="border-b border-border px-5 py-4">
            <Modal.Heading className="text-lg font-semibold">{t("autoComplete.title")}</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="px-5 py-5">
            <p role="alert" className="text-sm [overflow-wrap:anywhere]">{notice}</p>
          </Modal.Body>
          <Modal.Footer className="justify-end border-t border-border px-5 py-4">
            <Button size="sm" variant="outline" onPress={onClose}>{t("autoComplete.close")}</Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );

  return <>
    {/* 阶段一：篇章生成场景，自动生成 + 自动确认 */}
    {phase === "scenes" && !notice && (
      <HierarchyGeneration
        key={`auto-scenes:${arc.id}`}
        node={arc}
        choices={choices}
        choicesError={choicesError}
        autoRun
        autoConfirm
        autoHint={t("autoComplete.hint")}
        onPageChange={onGenerationPageChange}
        onSaved={async (records) => { handleScenesSaved(records); }}
        onClose={() => { if (!stopped.current && settled.current !== arc.id) { stopped.current = true; onClose(); } }}
      />
    )}

    {/* 阶段二：逐场景生成章计划，自动生成 + 自动确认 */}
    {phase === "plans" && currentScene && (
      <HierarchyGeneration
        key={`auto-plans:${currentScene.id}`}
        node={currentScene}
        choices={choices}
        choicesError={choicesError}
        planOrigin={{ scene: currentScene, arc, volume }}
        autoRun
        autoConfirm
        autoHint={t("autoComplete.hint")}
        onPageChange={onGenerationPageChange}
        onSaved={async (records) => { handlePlanSaved(records, currentScene); }}
        onClose={() => { if (!stopped.current && settled.current !== currentScene.id) { stopped.current = true; onClose(); } }}
      />
    )}
  </>;
}
