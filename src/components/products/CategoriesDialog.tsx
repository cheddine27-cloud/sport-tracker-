"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Category } from "@/types";
import { appDb } from "@/lib/db";
import {
  addCategory,
  deleteCategory,
  getCategories,
  renameCategory,
} from "@/services/categories";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}

export function CategoriesDialog({ open, onOpenChange, onChanged }: Props) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");

  const load = useCallback(async () => {
    try {
      setCategories(await getCategories(appDb));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر تحميل الأقسام");
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [open, load]);

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name) {
      toast.error("أدخل اسم القسم");
      return;
    }
    try {
      await addCategory(name, appDb);
      toast.success(`تمت إضافة القسم "${name}"`);
      setNewName("");
      await load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذرت إضافة القسم");
    }
  };

  const handleRename = async () => {
    if (editingId === null) return;
    const name = editName.trim();
    if (!name) {
      toast.error("أدخل الاسم الجديد");
      return;
    }
    try {
      await renameCategory(editingId, name, appDb);
      toast.success("تم تعديل اسم القسم");
      setEditingId(null);
      await load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر تعديل القسم");
    }
  };

  const handleDelete = async (cat: Category) => {
    try {
      await deleteCategory(cat.id, appDb);
      toast.success(`تم حذف القسم "${cat.name}"`);
      await load();
      onChanged();
    } catch (e) {
      // Blocked deletion -> show the Arabic error from the service
      toast.error(e instanceof Error ? e.message : "تعذر حذف القسم");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>إدارة الأقسام</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="اسم القسم الجديد"
            onKeyDown={(e) => e.key === "Enter" && void handleAdd()}
          />
          <Button onClick={() => void handleAdd()}>
            <Plus className="ms-2 h-4 w-4" />
            إضافة
          </Button>
        </div>

        <div className="grid gap-2 max-h-[50vh] overflow-y-auto pe-1">
          {categories.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              لا توجد أقسام بعد.
            </p>
          )}
          {categories.map((cat) => (
            <div
              key={cat.id}
              className="flex items-center gap-2 rounded-lg border p-2"
            >
              {editingId === cat.id ? (
                <>
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void handleRename()}
                    autoFocus
                  />
                  <Button size="sm" onClick={() => void handleRename()}>
                    حفظ
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditingId(null)}
                  >
                    إلغاء
                  </Button>
                </>
              ) : (
                <>
                  <span className="flex-1 truncate">{cat.name}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => {
                      setEditingId(cat.id);
                      setEditName(cat.name);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-red-600"
                    onClick={() => void handleDelete(cat)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
