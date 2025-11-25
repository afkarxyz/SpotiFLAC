import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, ArrowUpDown, XCircle } from "lucide-react";

interface SearchAndSortProps {
  searchQuery: string;
  sortBy: string;
  onSearchChange: (value: string) => void;
  onSortChange: (value: string) => void;
}

export function SearchAndSort({
  searchQuery,
  sortBy,
  onSearchChange,
  onSortChange,
}: SearchAndSortProps) {
  return (
    <div className="flex gap-2">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search tracks..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-10 pr-8"
        />
        {searchQuery && (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            onClick={() => onSearchChange("")}
          >
            <XCircle className="h-4 w-4" />
          </button>
        )}
      </div>
      <Select value={sortBy} onValueChange={onSortChange}>
        <SelectTrigger className="w-[200px] gap-1.5">
          <ArrowUpDown className="h-4 w-4" />
          <SelectValue placeholder="Sort by" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">Default</SelectItem>
          <SelectItem value="title-asc">Title (A-Z)</SelectItem>
          <SelectItem value="title-desc">Title (Z-A)</SelectItem>
          <SelectItem value="artist-asc">Artist (A-Z)</SelectItem>
          <SelectItem value="artist-desc">Artist (Z-A)</SelectItem>
          <SelectItem value="duration-asc">Duration (Short)</SelectItem>
          <SelectItem value="duration-desc">Duration (Long)</SelectItem>
          <SelectItem value="downloaded">Downloaded</SelectItem>
          <SelectItem value="not-downloaded">Not Downloaded</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
