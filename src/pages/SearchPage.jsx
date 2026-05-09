import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import SearchPage from '@/pages/SearchPage';
import SearchVehicles from '@/pages/SearchVehicles';
import FindDrivers from '@/pages/FindDrivers';

export default function SearchPage() {
  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Search</h1>
      <Tabs defaultValue="vehicles">
        <TabsList className="mb-4">
          <TabsTrigger value="vehicles">🔍 Find Vehicles</TabsTrigger>
          <TabsTrigger value="drivers">👤 Find Drivers</TabsTrigger>
        </TabsList>
        <TabsContent value="vehicles">
          <SearchVehicles embedded />
        </TabsContent>
        <TabsContent value="drivers">
          <FindDrivers embedded />
        </TabsContent>
      </Tabs>
    </div>
  );
}
