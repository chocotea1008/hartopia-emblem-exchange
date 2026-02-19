$files = Get-ChildItem "이미지소스"
$dataList = @()

foreach ($f in $files) {
    if ($f.Name -match "^(.+)_(\d+)\.(.+)\.png$") {
        $catRaw = $matches[1]
        $num = [int]$matches[2]
        $desc = $matches[3]
        
        $catKey = switch ($catRaw) {
            "빛나는" { "shiny" }
            "네뷸라" { "nebula" }
            "무지개" { "rainbow" }
            default { "misc" }
        }

        $obj = [ordered]@{
            id = "$($catKey)_$($num)"
            category = $catKey
            categoryRaw = $catRaw
            src = "이미지소스/$($f.Name)"
            status = "center"
            number = $num
            description = $desc
        }
        $dataList += $obj
    }
}

# Sort by Category (Shiny -> Nebula -> Rainbow) then Number
# Order: Shiny (빛나는), Nebula (네뷸라), Rainbow (무지개)
# Custom sort: 
$dataList = $dataList | Sort-Object @{Expression={
    switch ($_.category) {
        "shiny" { 0 }
        "nebula" { 1 }
        "rainbow" { 2 }
        default { 3 }
    }
}}, number

$jsonContent = $dataList | ConvertTo-Json -Depth 4
$jsContent = "export const items = $jsonContent;"
$jsContent | Out-File -Encoding utf8 "js/data.js"
