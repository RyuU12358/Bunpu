import type { FunctionDef } from "./functionRegistry";
import { useEffect, useRef } from "react";
import { useTranslation } from "./i18n";
import "./SuggestionList.css";

interface SuggestionListProps {
  suggestions: FunctionDef[];
  selectedIndex: number;
  onSelect: (func: FunctionDef) => void;
  position: { top: number; left: number };
}

export const SuggestionList = ({
  suggestions,
  selectedIndex,
  onSelect,
  position,
}: SuggestionListProps) => {
  const { t } = useTranslation();
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (listRef.current) {
      const item = listRef.current.children[selectedIndex] as HTMLElement;
      if (item) {
        item.scrollIntoView({ block: "nearest" });
      }
    }
  }, [selectedIndex]);

  if (suggestions.length === 0) return null;

  return (
    <ul
      className="suggestion-list"
      ref={listRef}
      style={{
        top: position.top,
        left: position.left,
      }}
    >
      {suggestions.map((func, index) => (
        <li
          key={func.name}
          className={index === selectedIndex ? "selected" : ""}
          onMouseDown={(e) => {
            e.preventDefault(); // Prevent input blur
            onSelect(func);
          }}
        >
          <div className="func-name">{func.name}</div>
          <div className="func-meta">
            <span className="func-args">({func.args.join(", ")})</span>
            <span className="func-desc">
              {/* @ts-expect-error: dynamic key might not exist in translation types */}
              {t(`func_${func.name}`) || func.description}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
};
