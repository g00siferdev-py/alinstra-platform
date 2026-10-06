"use client";

import { useRouter } from "next/navigation";
import { Label, Select } from "@/components/ui";

export function MonthPicker({
  selected,
  options,
  basePath,
}: {
  selected: string;
  options: Array<{ value: string; label: string }>;
  basePath: string;
}) {
  const router = useRouter();
  return (
    <div className="grid max-w-xs gap-1">
      <Label htmlFor="report-month">Month</Label>
      <Select
        id="report-month"
        value={selected}
        onChange={(event) => {
          router.push(`${basePath}?month=${event.target.value}`);
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
