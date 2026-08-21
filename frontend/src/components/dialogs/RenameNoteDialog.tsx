import { useEffect, useRef, useState } from "react";
import { PencilLine } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Button } from "../ui/button";

interface RenameNoteDialogProps {
  open: boolean;
  initialTitle: string;
  onClose: () => void;
  onRename: (title: string) => void;
}

/** Lets the user edit a note's title from the editor's ⋯ menu. */
export function RenameNoteDialog({
  open,
  initialTitle,
  onClose,
  onRename,
}: RenameNoteDialogProps) {
  const [title, setTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTitle(initialTitle);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [open, initialTitle]);

  const submit = () => {
    if (!title.trim()) return;
    onRename(title.trim());
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PencilLine className="size-4 text-(--link-strong)" />
            Rename note
          </DialogTitle>
          <DialogDescription>
            Every note that links to “{initialTitle}” is updated to point at
            the new title automatically.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Note title"
            className="text-[14px]"
            autoComplete="off"
          />
          <DialogFooter className="mt-4">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!title.trim() || title.trim() === initialTitle}
            >
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
