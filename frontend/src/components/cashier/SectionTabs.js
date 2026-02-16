import React from 'react';

function SectionTabs({ sections, activeSectionId, onChangeSection }) {
  const visibleSections = sections.filter((section) => section?.is_active !== false);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-soft">
      <div className="flex gap-2 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => onChangeSection('')}
          className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${
            activeSectionId
              ? 'border border-slate-200 bg-white text-slate-700 hover:border-brandYellow'
              : 'bg-brandYellow text-ink'
          }`}
        >
          All Menu
        </button>
        {visibleSections.map((section) => (
          <button
            key={section.id}
            type="button"
            onClick={() => onChangeSection(section.id)}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              activeSectionId === section.id
                ? 'bg-brandYellow text-ink'
                : 'border border-slate-200 bg-white text-slate-700 hover:border-brandYellow'
            }`}
          >
            {section.name}
          </button>
        ))}
      </div>
    </div>
  );
}

export default SectionTabs;
