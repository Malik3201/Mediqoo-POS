import dbConnect from "@/lib/db";
import Feedback from "@/models/Feedback";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ExternalLink } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function FeedbacksPage() {
  await dbConnect();
  
  // Fetch feedbacks sorted by newest first
  const feedbacks = await Feedback.find({}).sort({ createdAt: -1 }).lean();

  return (
    <div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Issues & Suggestions</h2>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>User Feedback</CardTitle>
          <CardDescription>
            Review and manage issues and suggestions submitted by users from the landing page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Attachments</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {feedbacks.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center">
                      No feedback submitted yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  feedbacks.map((item: any) => (
                    <TableRow key={item._id.toString()}>
                      <TableCell>
                        <Badge variant={item.type === "issue" ? "destructive" : "default"}>
                          {item.type.toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {item.priority && (
                          <Badge variant="outline" className="capitalize">
                            {item.priority}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{item.name}</span>
                          <span className="text-xs text-muted-foreground">{item.email}</span>
                          <span className="text-xs text-muted-foreground">{item.phone}</span>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[300px]">
                        <p className="truncate" title={item.description}>
                          {item.description}
                        </p>
                      </TableCell>
                      <TableCell>
                        {item.screenshots && item.screenshots.length > 0 ? (
                          <div className="flex gap-2 flex-wrap">
                            {item.screenshots.map((url: string, i: number) => (
                              <a
                                key={i}
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center text-xs text-blue-500 hover:underline"
                              >
                                View <ExternalLink className="ml-1 h-3 w-3" />
                              </a>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">None</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {new Date(item.createdAt).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
