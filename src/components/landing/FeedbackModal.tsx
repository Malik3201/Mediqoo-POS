"use client";

import { useState } from "react";
import { MessageSquarePlus, UploadCloud, X, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

export function FeedbackModal() {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"issue" | "suggestion">("issue");
  const [priority, setPriority] = useState<"low" | "medium" | "high" | "critical">("medium");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      setFiles((prev) => [...prev, ...newFiles]);
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email || !phone || !description) {
      toast.error("Please fill in all required fields.");
      return;
    }

    setIsSubmitting(true);
    try {
      let uploadedUrls: string[] = [];

      // 1. Upload files if any
      if (files.length > 0) {
        const fileMetadata = files.map((f) => ({ filename: f.name, fileType: f.type }));
        
        const uploadRes = await fetch("/api/public/feedback/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ files: fileMetadata }),
        });
        const uploadJson = await uploadRes.json();

        if (!uploadJson.success) {
          throw new Error("Failed to get upload URLs");
        }

        // Upload to S3 directly
        const uploadPromises = files.map(async (file, index) => {
          const { uploadUrl, publicUrl } = uploadJson.results[index];
          await fetch(uploadUrl, {
            method: "PUT",
            body: file,
            headers: { "Content-Type": file.type },
          });
          return publicUrl;
        });

        uploadedUrls = await Promise.all(uploadPromises);
      }

      // 2. Submit form data
      const payload = {
        type,
        priority: type === "issue" ? priority : undefined,
        name,
        email,
        phone,
        description,
        screenshots: uploadedUrls,
      };

      const res = await fetch("/api/public/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();

      if (json.success) {
        toast.success("Thank you! Your feedback has been submitted.");
        // Reset form
        setType("issue");
        setName("");
        setEmail("");
        setPhone("");
        setDescription("");
        setFiles([]);
        setOpen(false);
      } else {
        throw new Error(json.error || "Failed to submit");
      }
    } catch (error) {
      console.error(error);
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-2xl z-50 transition-transform hover:scale-110"
          size="icon"
        >
          <MessageSquarePlus className="h-6 w-6" />
          <span className="sr-only">Submit Feedback</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Submit Issue or Suggestion</DialogTitle>
          <DialogDescription>
            Help us improve Aivrasol POS by reporting issues or sharing your ideas.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={type} onValueChange={(val: any) => setType(val)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="issue">Issue / Bug</SelectItem>
                  <SelectItem value="suggestion">Suggestion / Idea</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            {type === "issue" && (
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select value={priority} onValueChange={(val: any) => setPriority(val)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select priority" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your full name"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email *</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone *</Label>
              <Input
                id="phone"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 234 567 890"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="desc">Description *</Label>
            <Textarea
              id="desc"
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                type === "issue"
                  ? "Describe the issue, steps to reproduce, etc."
                  : "Describe your feature suggestion or idea."
              }
              className="min-h-[100px]"
            />
          </div>

          <div className="space-y-2">
            <Label>Screenshots (Optional)</Label>
            <div className="flex items-center gap-4">
              <Button
                type="button"
                variant="outline"
                className="w-full h-20 border-dashed"
                onClick={() => document.getElementById("file-upload")?.click()}
              >
                <UploadCloud className="mr-2 h-4 w-4" />
                Upload Images
              </Button>
              <input
                id="file-upload"
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
            
            {files.length > 0 && (
              <div className="flex flex-col gap-2 mt-2">
                {files.map((file, i) => (
                  <div key={i} className="flex items-center justify-between bg-muted p-2 rounded-md text-sm">
                    <span className="truncate max-w-[250px]">{file.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => removeFile(i)}
                    >
                      <X className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Submitting...
              </>
            ) : (
              "Submit"
            )}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
