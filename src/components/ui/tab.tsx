'use client';

import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import { cn } from 'cn';

function Tab({ value, children, className, ...props }: {
  value: string;
  children: React.ReactNode;
  className?: string;
  [key: string]: unknown;
}) {
  return (
    <TabsPrimitive.Tab
      value={value}
      className={cn(
        "after:after-absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:transition-colors data-[state=active]:after:h-6 data-[state=active]:after:bg-primary data-[state=active]:text-primary data-[state=hover]:after:h-2 group-data-[state=active]:text-primary group-data-[state=hover]:after:h-2 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className
      )}
      {...props}
    >
      {children}
    </TabsPrimitive.Tab>
  );
}

export { Tab };
