"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ExternalLink } from "lucide-react";

export function FeedbacksTable({ feedbacks }: { feedbacks: any[] }) {
  const [selectedFeedback, setSelectedFeedback] = useState<any | null>(null);

  return (
    <>
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
                <TableRow 
                  key={item._id.toString()} 
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => setSelectedFeedback(item)}
                >
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
                      <span className="text-xs text-blue-500 font-medium">
                        {item.screenshots.length} File(s)
                      </span>
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

      <Dialog open={!!selectedFeedback} onOpenChange={(v) => !v && setSelectedFeedback(null)}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          {selectedFeedback && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-xl">
                  Feedback Details
                  <Badge variant={selectedFeedback.type === "issue" ? "destructive" : "default"}>
                    {selectedFeedback.type.toUpperCase()}
                  </Badge>
                  {selectedFeedback.priority && (
                    <Badge variant="outline" className="capitalize">
                      {selectedFeedback.priority}
                    </Badge>
                  )}
                </DialogTitle>
                <DialogDescription>
                  Submitted on {new Date(selectedFeedback.createdAt).toLocaleDateString()}
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-2 gap-4 text-sm bg-muted/50 p-4 rounded-lg">
                  <div>
                    <span className="font-semibold block text-muted-foreground">Name</span>
                    {selectedFeedback.name}
                  </div>
                  <div>
                    <span className="font-semibold block text-muted-foreground">Email</span>
                    {selectedFeedback.email}
                  </div>
                  <div className="col-span-2">
                    <span className="font-semibold block text-muted-foreground">Phone</span>
                    {selectedFeedback.phone}
                  </div>
                </div>

                <div>
                  <span className="font-semibold block text-sm text-muted-foreground mb-1">Description</span>
                  <div className="text-sm bg-card border rounded-md p-4 whitespace-pre-wrap">
                    {selectedFeedback.description}
                  </div>
                </div>

                {selectedFeedback.screenshots && selectedFeedback.screenshots.length > 0 && (
                  <div>
                    <span className="font-semibold block text-sm text-muted-foreground mb-2">Attachments</span>
                    <div className="grid grid-cols-2 gap-4">
                      {selectedFeedback.screenshots.map((url: string, i: number) => (
                        <a
                          key={i}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group relative block overflow-hidden rounded-md border aspect-video bg-muted"
                        >
                          {/* We use an img tag for thumbnails to make it look great */}
                          <img
                            src={url}
                            alt={`Attachment ${i + 1}`}
                            className="object-cover w-full h-full transition-transform group-hover:scale-105"
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <ExternalLink className="text-white h-6 w-6" />
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
