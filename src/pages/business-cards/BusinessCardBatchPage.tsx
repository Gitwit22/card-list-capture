import { BusinessCardWorkflow } from '@/components/business-cards/BusinessCardWorkflow';

export default function BusinessCardBatchPage() {
  return (
    <BusinessCardWorkflow
      mode="rapid"
      title="Scan A Stack Fast"
      subtitle="Capture front, then optionally back, then move to the next card."
    />
  );
}
