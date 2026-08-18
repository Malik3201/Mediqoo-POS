import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function ComingSoon({
  title,
  milestone,
  description,
}: {
  title: string;
  milestone: string;
  description: string;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <Badge variant="outline">{milestone}</Badge>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Planned</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>{description}</p>
          <p className="mt-2">
            This section is scheduled for {milestone}. The Milestone 1 foundation (auth, database,
            audit log, admin shell) is in place and ready to host it.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
