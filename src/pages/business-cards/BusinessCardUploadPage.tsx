import { BusinessCardWorkflow } from '@/components/business-cards/BusinessCardWorkflow';

export default function BusinessCardUploadPage() {
  return (
    <BusinessCardWorkflow
      mode="multi-upload"
      title="Upload Multiple Photos"
      subtitle="Upload photos, pair front/back in queue, process, review, and export one row per card."
    />
  );
}
