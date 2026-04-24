import { BusinessCardWorkflow } from '@/components/business-cards/BusinessCardWorkflow';

export default function BusinessCardUploadPage() {
  return (
    <BusinessCardWorkflow
      mode="multi-upload"
      title="Upload Multiple Photos"
      subtitle="Upload photos in single-card mode or detect multiple cards per photo, then review everything in one export session."
    />
  );
}
