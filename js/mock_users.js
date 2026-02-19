export const mockUsers = [
    {
        id: "user123",
        name: "휘장왕",
        timestamp: new Date(Date.now() - 3600000).toISOString(),
        buying: ["shiny_1", "shiny_2"],
        selling: ["rainbow_3", "rainbow_4", "nebula_1"]
    },
    {
        id: "user456",
        name: "거래빌런",
        timestamp: new Date(Date.now() - 7200000).toISOString(),
        buying: ["shiny_1", "nebula_2"],
        selling: ["shiny_2", "rainbow_1"]
    },
    {
        id: "user789",
        name: "휘장장인",
        timestamp: new Date(Date.now() - 500000).toISOString(),
        buying: ["rainbow_3", "nebula_5"],
        selling: ["shiny_1", "shiny_2"]
    },
    {
        id: "user_collector",
        name: "휘장수집가",
        timestamp: new Date(Date.now() - 100000).toISOString(),
        buying: ["shiny_1"],
        selling: ["shiny_2"]
    }
];
