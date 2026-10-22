using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace Luncher.Companion;

// One generic dialog rather than a XAML file per prompt: the fields differ only in
// label, default value and whether they accept multiple lines.
public partial class InputDialog : Window
{
    private readonly List<TextBox> _boxes = new();

    public InputDialog(string title, params (string Label, string Default, bool Multiline)[] fields)
    {
        InitializeComponent();
        Title = title;
        FlowDirection = Strings.Get("K_Title").Contains("لانچر")
            ? FlowDirection.RightToLeft : FlowDirection.LeftToRight;

        foreach (var f in fields)
        {
            FieldsPanel.Children.Add(new TextBlock
            {
                Text = f.Label,
                Margin = new Thickness(0, 10, 0, 4),
                Foreground = new SolidColorBrush(Color.FromRgb(0x8B, 0x98, 0xA9)),
            });

            var box = new TextBox
            {
                Text = f.Default ?? "",
                Padding = new Thickness(8, 6, 8, 6),
                Background = new SolidColorBrush(Color.FromRgb(0x11, 0x18, 0x27)),
                Foreground = new SolidColorBrush(Color.FromRgb(0xE6, 0xED, 0xF3)),
                BorderBrush = new SolidColorBrush(Color.FromRgb(0x2A, 0x36, 0x46)),
                AcceptsReturn = f.Multiline,
                TextWrapping = f.Multiline ? TextWrapping.Wrap : TextWrapping.NoWrap,
                VerticalScrollBarVisibility = f.Multiline
                    ? ScrollBarVisibility.Auto : ScrollBarVisibility.Disabled,
                MinHeight = f.Multiline ? 96 : 0,
                FontFamily = new FontFamily("Consolas, Segoe UI"),
            };
            _boxes.Add(box);
            FieldsPanel.Children.Add(box);
        }

        Loaded += (_, _) => { if (_boxes.Count > 0) _boxes[0].Focus(); };
    }

    public IReadOnlyList<string> Values => _boxes.Select(b => b.Text).ToList();

    private void OnOk(object sender, RoutedEventArgs e) { DialogResult = true; }
    private void OnCancel(object sender, RoutedEventArgs e) { DialogResult = false; }
}
