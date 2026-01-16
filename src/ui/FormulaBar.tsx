import {
  useState,
  useEffect,
  forwardRef,
  useImperativeHandle,
  useRef,
} from "react";
import { graph } from "../graphInstance";
import "./FormulaBar.css";
import { SuggestionList } from "./SuggestionList";
import { functionRegistry } from "./functionRegistry";
import type { FunctionDef } from "./functionRegistry";

interface FormulaBarProps {
  selectedId: string | null;
  onCommit: (value: string) => void;
}

export interface FormulaBarRef {
  beginEdit: (initialValue?: string) => void;
}

export const FormulaBar = forwardRef<FormulaBarRef, FormulaBarProps>(
  ({ selectedId, onCommit }, ref) => {
    const [value, setValue] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);
    const committedRef = useRef(false); // Track if already committed to prevent double-commit

    // Autocomplete State
    const [suggestions, setSuggestions] = useState<FunctionDef[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [suggestionPos, setSuggestionPos] = useState({ top: 30, left: 0 });

    useImperativeHandle(ref, () => ({
      beginEdit: (initialValue?: string) => {
        if (initialValue !== undefined) setValue(initialValue);
        inputRef.current?.focus();
      },
    }));

    // Update input when selection changes (read from graph)
    useEffect(() => {
      if (selectedId) {
        const cell = graph.getCell(selectedId);
        // eslint-disable-next-line
        setValue(cell ? cell.rawInput : "");
      } else {
        setValue("");
      }
      setSuggestions([]); // Clear suggestions on switch
      committedRef.current = false; // Reset committed flag on cell change
    }, [selectedId]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setValue(val);

      const cursor = e.target.selectionStart || 0;
      const textBeforeCursor = val.slice(0, cursor);

      // Regex to find "potential function start":
      // 1. Must be inside a formula (starts with =)
      // 2. Preceded by =, (, +, -, *, /, or comma
      // 3. Followed by optional uppercase letters (the prefix)
      if (!val.startsWith("=")) {
        setSuggestions([]);
        return;
      }

      // Matches:
      // Group 1: The separator/trigger character (=, (, +, -, *, /, ,)
      // Group 2: The prefix being typed (can be empty string if just typed the separator)
      const match = textBeforeCursor.match(/(=|[(+\-*/,])\s*([A-Za-z]*)/);

      if (match) {
        const prefix = match[2]; // Group 2 is the prefix

        // Filter registry
        let matches = [];
        if (prefix === "") {
          matches = functionRegistry; // Show all if no prefix
        } else {
          const upperPrefix = prefix.toUpperCase();
          matches = functionRegistry.filter((f) =>
            f.name.startsWith(upperPrefix)
          );
        }

        if (matches.length > 0) {
          setSuggestions(matches);
          setSelectedIndex(0);
          // Calculate position approx
          // Group 1 is 1 char. Group 2 is length of prefix.
          // We want left offset to be at the start of the prefix.
          const prefixStartLen = textBeforeCursor.length - prefix.length;
          const leftOffset = prefixStartLen * 8;
          setSuggestionPos({ top: 30, left: Math.min(leftOffset, 300) + 20 });
          return;
        }
      }
      setSuggestions([]);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      // 1. Suggestion Navigation
      if (suggestions.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedIndex((i) => (i + 1) % suggestions.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedIndex(
            (i) => (i - 1 + suggestions.length) % suggestions.length
          );
          return;
        }
        if (e.key === "Tab" || e.key === "Enter") {
          e.preventDefault();
          completeSuggestion(suggestions[selectedIndex]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setSuggestions([]);
          return;
        }
      }
      // 2. Normal Commit
      if (e.key === "Enter" && selectedId) {
        committedRef.current = true; // Mark as committed
        onCommit(value);
        setSuggestions([]);
        // Don't blur here - it would trigger handleBlur and double-commit
        // Just prevent default to avoid form submission
        e.preventDefault();
      }
    };

    const completeSuggestion = (func: FunctionDef) => {
      if (!inputRef.current) return;
      const cursor = inputRef.current.selectionStart || 0;
      const textBefore = value.slice(0, cursor);
      const textAfter = value.slice(cursor);

      // Re-run regex to find what we are replacing
      const match = textBefore.match(/(=|[(+\-*/,])\s*([A-Za-z]*)$/);

      if (match) {
        const prefix = match[2];
        // Replace prefix with func name + (
        const newVal =
          textBefore.slice(0, textBefore.length - prefix.length) +
          func.name +
          "(" +
          textAfter;
        setValue(newVal);
        setSuggestions([]);
        // Restore focus and move cursor
        setTimeout(() => {
          const newCursor = cursor - prefix.length + func.name.length + 1;
          inputRef.current?.setSelectionRange(newCursor, newCursor);
          inputRef.current?.focus();
        }, 0);
      }
    };

    const handleBlur = () => {
      // Delay commit to allow suggestion click
      setTimeout(() => {
        // Skip if already committed (e.g., via Enter key)
        if (committedRef.current) {
          committedRef.current = false; // Reset for next edit
          setSuggestions([]);
          return;
        }
        if (selectedId) {
          onCommit(value);
        }
        setSuggestions([]);
      }, 150);
    };

    return (
      <div className="formula-bar" style={{ flex: 1, position: "relative" }}>
        <input
          ref={inputRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={selectedId ? `${selectedId}...` : ""}
          style={{ width: "100%", boxSizing: "border-box", padding: "4px 8px" }}
        />
        {suggestions.length > 0 && (
          <SuggestionList
            suggestions={suggestions}
            selectedIndex={selectedIndex}
            onSelect={completeSuggestion}
            position={suggestionPos}
          />
        )}
      </div>
    );
  }
);
