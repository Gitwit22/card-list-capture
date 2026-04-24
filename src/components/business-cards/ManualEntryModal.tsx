import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface ManualEntryModalProps {
  sourceImageName: string;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (entryData: {
    fullName: string;
    firstName: string;
    lastName: string;
    company: string;
    title: string;
    email: string;
    phone: string;
    website: string;
    address: string;
  }) => Promise<void>;
  isLoading?: boolean;
}

export function ManualEntryModal({
  sourceImageName,
  isOpen,
  onClose,
  onConfirm,
  isLoading,
}: ManualEntryModalProps) {
  const [formData, setFormData] = useState({
    fullName: '',
    firstName: '',
    lastName: '',
    company: '',
    title: '',
    email: '',
    phone: '',
    website: '',
    address: '',
  });

  const handleConfirm = async () => {
    await onConfirm(formData);
    setFormData({
      fullName: '',
      firstName: '',
      lastName: '',
      company: '',
      title: '',
      email: '',
      phone: '',
      website: '',
      address: '',
    });
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Manual Entry: {sourceImageName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="fullName" className="text-xs font-medium">
              Full Name
            </Label>
            <Input
              id="fullName"
              value={formData.fullName}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  fullName: e.target.value,
                }))
              }
              placeholder="John Doe"
              className="text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="firstName" className="text-xs font-medium">
                First Name
              </Label>
              <Input
                id="firstName"
                value={formData.firstName}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    firstName: e.target.value,
                  }))
                }
                placeholder="John"
                className="text-sm"
              />
            </div>
            <div>
              <Label htmlFor="lastName" className="text-xs font-medium">
                Last Name
              </Label>
              <Input
                id="lastName"
                value={formData.lastName}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    lastName: e.target.value,
                  }))
                }
                placeholder="Doe"
                className="text-sm"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="company" className="text-xs font-medium">
              Company
            </Label>
            <Input
              id="company"
              value={formData.company}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  company: e.target.value,
                }))
              }
              placeholder="Acme Corp"
              className="text-sm"
            />
          </div>

          <div>
            <Label htmlFor="title" className="text-xs font-medium">
              Title
            </Label>
            <Input
              id="title"
              value={formData.title}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  title: e.target.value,
                }))
              }
              placeholder="CEO"
              className="text-sm"
            />
          </div>

          <div>
            <Label htmlFor="email" className="text-xs font-medium">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  email: e.target.value,
                }))
              }
              placeholder="john@example.com"
              className="text-sm"
            />
          </div>

          <div>
            <Label htmlFor="phone" className="text-xs font-medium">
              Phone
            </Label>
            <Input
              id="phone"
              value={formData.phone}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  phone: e.target.value,
                }))
              }
              placeholder="(555) 123-4567"
              className="text-sm"
            />
          </div>

          <div>
            <Label htmlFor="website" className="text-xs font-medium">
              Website
            </Label>
            <Input
              id="website"
              value={formData.website}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  website: e.target.value,
                }))
              }
              placeholder="https://example.com"
              className="text-sm"
            />
          </div>

          <div>
            <Label htmlFor="address" className="text-xs font-medium">
              Address
            </Label>
            <Input
              id="address"
              value={formData.address}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  address: e.target.value,
                }))
              }
              placeholder="123 Main St, City, ST 12345"
              className="text-sm"
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={isLoading}>
            {isLoading ? 'Creating...' : 'Create Entry'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
