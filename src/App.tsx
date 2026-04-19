import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import BusinessCardSelector from "./pages/business-cards/BusinessCardSelector.tsx";
import BusinessCardSinglePage from "./pages/business-cards/BusinessCardSinglePage.tsx";
import BusinessCardBatchPage from "./pages/business-cards/BusinessCardBatchPage.tsx";
import BusinessCardUploadPage from "./pages/business-cards/BusinessCardUploadPage.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/business-cards" element={<BusinessCardSelector />} />
          <Route path="/business-cards/single" element={<BusinessCardSinglePage />} />
          <Route path="/business-cards/batch" element={<BusinessCardBatchPage />} />
          <Route path="/business-cards/upload" element={<BusinessCardUploadPage />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
