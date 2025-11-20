"""查看数据库内容"""
import sqlite3
from datetime import datetime

db_path = "reader_data.db"

print("=" * 60)
print("数据库内容检查")
print("=" * 60)
print(f"\n数据库位置: {db_path}")
print()

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# 检查highlights表
print("📚 Highlights (高亮) 表:")
print("-" * 60)
cursor.execute("SELECT COUNT(*) FROM highlights")
count = cursor.fetchone()[0]
print(f"总记录数: {count}")

if count > 0:
    cursor.execute("""
        SELECT id, book_id, chapter_index, 
               substr(selected_text, 1, 50) as text_preview,
               created_at
        FROM highlights 
        ORDER BY created_at DESC 
        LIMIT 5
    """)
    
    print("\n最近的5条记录:")
    for row in cursor.fetchall():
        print(f"\nID: {row[0]}")
        print(f"  书籍: {row[1]}")
        print(f"  章节: {row[2]}")
        print(f"  文本: {row[3]}...")
        print(f"  时间: {row[4]}")

print("\n" + "=" * 60)

# 检查ai_analyses表
print("🤖 AI Analyses (AI分析) 表:")
print("-" * 60)
cursor.execute("SELECT COUNT(*) FROM ai_analyses")
count = cursor.fetchone()[0]
print(f"总记录数: {count}")

if count > 0:
    cursor.execute("""
        SELECT id, highlight_id, analysis_type,
               substr(prompt, 1, 50) as prompt_preview,
               substr(response, 1, 100) as response_preview,
               created_at
        FROM ai_analyses 
        ORDER BY created_at DESC 
        LIMIT 5
    """)
    
    print("\n最近的5条记录:")
    for row in cursor.fetchall():
        print(f"\nID: {row[0]}")
        print(f"  关联高亮ID: {row[1]}")
        print(f"  分析类型: {row[2]}")
        print(f"  提示: {row[3]}...")
        print(f"  响应: {row[4]}...")
        print(f"  时间: {row[5]}")

print("\n" + "=" * 60)

# 统计信息
print("📊 统计信息:")
print("-" * 60)

cursor.execute("""
    SELECT analysis_type, COUNT(*) 
    FROM ai_analyses 
    GROUP BY analysis_type
""")
stats = cursor.fetchall()

if stats:
    print("\n按分析类型统计:")
    for row in stats:
        print(f"  {row[0]}: {row[1]} 条")
else:
    print("  暂无数据")

conn.close()

print("\n" + "=" * 60)
print("✓ 检查完成")
print("=" * 60)
