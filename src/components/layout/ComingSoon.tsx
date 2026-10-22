import { Card, CardContent } from "@/components/ui/card";
import { Clock } from "lucide-react";

export function ComingSoon() {
  return (
    <Card className="rounded-2xl shadow-sm">
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <Clock className="size-7" />
        </div>
        <p className="text-lg font-semibold">قريبا</p>
        <p className="text-sm text-muted-foreground">
          هذه الميزة قيد التطوير وستتوفر في تحديث قادم.
        </p>
      </CardContent>
    </Card>
  );
}
