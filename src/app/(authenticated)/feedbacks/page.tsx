import dbConnect from "@/lib/db";
import Feedback from "@/models/Feedback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FeedbacksTable } from "./FeedbacksTable";

export const dynamic = "force-dynamic";

export default async function FeedbacksPage() {
  await dbConnect();
  
  // Fetch feedbacks sorted by newest first
  // Ensure we lean and map the _id to strings to pass safely to Client Components
  const rawFeedbacks = await Feedback.find({}).sort({ createdAt: -1 }).lean();
  const feedbacks = rawFeedbacks.map((fb: any) => ({
    ...fb,
    _id: fb._id.toString(),
    createdAt: fb.createdAt.toISOString(),
    updatedAt: fb.updatedAt.toISOString(),
  }));

  return (
    <div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Issues & Suggestions</h2>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>User Feedback</CardTitle>
          <CardDescription>
            Review and manage issues and suggestions submitted by users from the landing page. Click on any row to view full details.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FeedbacksTable feedbacks={feedbacks} />
        </CardContent>
      </Card>
    </div>
  );
}
