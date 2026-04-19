import { BusinessCardWorkflow } from '@/components/business-cards/BusinessCardWorkflow';

export default function BusinessCardSinglePage() {
  return (
    <BusinessCardWorkflow
      mode="single"
      title="Scan One Card"
      subtitle="Capture front, then scan back or skip, and process as a single card record."
    />
  );
}
