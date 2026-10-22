using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace Luncher.Companion;

public partial class MainWindow : Window
{
    private List<FoundClient> _clients = new();

    public MainWindow()
    {
        var lang = ConfigStore.Language;
        Strings.Apply(lang);          // before InitializeComponent so DynamicResource resolves
        InitializeComponent();
        FlowDirection = lang == "fa" ? FlowDirection.RightToLeft : FlowDirection.LeftToRight;

        // Right-clicking a ListBoxItem does not select it in WPF, so without this
        // the context menu would act on whatever was last left-clicked — silently
        // deleting the wrong config. Select the row under the cursor instead.
        SelectOnRightClick(ConfigList);
        SelectOnRightClick(SubList);

        Render();
        Loaded += async (_, _) =>
        {
            _clients = Clients.Detect();
            Status(_clients.Count == 0
                ? Strings.Get("K_NoClient")
                : string.Format(Strings.Get("K_ClientFound"), _clients[0].Name, _clients.Count));
            await Task.CompletedTask;
        };
    }

    private static void SelectOnRightClick(ListBox list)
    {
        list.PreviewMouseRightButtonDown += (s, e) =>
        {
            var item = FindAncestor<ListBoxItem>(e.OriginalSource as DependencyObject);
            if (item == null) return;
            item.Focus();
            list.SelectedItem = item.DataContext;
        };
    }

    private static T FindAncestor<T>(DependencyObject node) where T : DependencyObject
    {
        while (node != null)
        {
            if (node is T match) return match;
            node = VisualTreeHelper.GetParent(node) ?? LogicalTreeHelper.GetParent(node);
        }
        return null;
    }

    private void Status(string text) => StatusText.Text = text;

    private void Render()
    {
        var store = ConfigStore.Load();
        ConfigList.ItemsSource = null;
        SubList.ItemsSource = null;
        ConfigList.ItemsSource = store.Configs.OrderByDescending(c => c.AddedAt).ToList();
        SubList.ItemsSource = store.Subs.ToList();
        ConfigsHeading.Text = store.Configs.Count == 0
            ? Strings.Get("K_Configs")
            : string.Format(Strings.Get("K_ConfigsCount"), store.Configs.Count);
        EmptyState.Visibility = store.Configs.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        ConfigList.Visibility = store.Configs.Count == 0 ? Visibility.Collapsed : Visibility.Visible;
    }

    private ConfigItem SelectedConfig => ConfigList.SelectedItem as ConfigItem;
    private SubscriptionItem SelectedSub => SubList.SelectedItem as SubscriptionItem;

    // ---- toolbar ----

    private void OnLang(object sender, RoutedEventArgs e)
    {
        var next = ConfigStore.Language == "fa" ? "en" : "fa";
        ConfigStore.Language = next;
        Strings.Apply(next);
        FlowDirection = next == "fa" ? FlowDirection.RightToLeft : FlowDirection.LeftToRight;
        Render();
        Status(Strings.Get("K_StatusReady"));
    }

    private void OnAddLink(object sender, RoutedEventArgs e)
    {
        var dlg = new InputDialog(Strings.Get("K_DlgLinkTitle"),
            (Strings.Get("K_DlgLinkName"), "", false),
            (Strings.Get("K_DlgLinkText"), "", true)) { Owner = this };
        if (dlg.ShowDialog() != true) return;

        var name = dlg.Values[0].Trim();
        var links = ConfigStore.ExtractLinks(dlg.Values[1]);
        if (links.Count == 0) { Status(Strings.Get("K_AddedNone")); return; }
        var added = ConfigStore.AddLinks(links, null, name.Length == 0 ? null : name);
        Render();
        Status(string.Format(Strings.Get("K_AddedMany"), added));
    }

    private void OnAddSub(object sender, RoutedEventArgs e)
    {
        var dlg = new InputDialog(Strings.Get("K_DlgSubTitle"),
            (Strings.Get("K_DlgSubName"), "", false),
            (Strings.Get("K_DlgSubUrl"), "https://", false)) { Owner = this };
        if (dlg.ShowDialog() != true) return;

        var url = dlg.Values[1].Trim();
        if (!Uri.TryCreate(url, UriKind.Absolute, out var parsed) ||
            (parsed.Scheme != "http" && parsed.Scheme != "https"))
        {
            Status(Strings.Get("K_BadUrl"));
            return;
        }
        var sub = ConfigStore.AddSubscription(dlg.Values[0].Trim(), url);
        Render();
        _ = RefreshSubscriptionAsync(sub);
    }

    private void OnRefresh(object sender, RoutedEventArgs e)
    {
        foreach (var sub in ConfigStore.Load().Subs.ToList())
            _ = RefreshSubscriptionAsync(sub);
        if (ConfigStore.Load().Subs.Count == 0) Status(Strings.Get("K_NoSubs"));
    }

    private void OnCopyAll(object sender, RoutedEventArgs e)
    {
        var links = ConfigStore.Load().Configs.Select(c => c.Link).ToList();
        if (links.Count == 0) { Status(Strings.Get("K_Empty")); return; }
        try
        {
            Clipboard.SetText(string.Join("\n", links));
            Status(string.Format(Strings.Get("K_CopiedAll"), links.Count));
        }
        catch (Exception ex) { Status(ex.Message); }
    }

    private void OnExport(object sender, RoutedEventArgs e)
    {
        var links = ConfigStore.Load().Configs.Select(c => c.Link).ToList();
        if (links.Count == 0) { Status(Strings.Get("K_Empty")); return; }

        var dlg = new Microsoft.Win32.SaveFileDialog
        {
            FileName = "luncher-configs.txt",
            Filter = Strings.Get("K_FilterTxt") + "|*.txt|" + Strings.Get("K_FilterAll") + "|*.*",
        };
        if (dlg.ShowDialog(this) != true) return;
        try
        {
            File.WriteAllText(dlg.FileName, string.Join("\n", links), new UTF8Encoding(false));
            Status(string.Format(Strings.Get("K_Exported"), dlg.FileName));
        }
        catch (Exception ex) { Status(ex.Message); }
    }

    private void OnOpenClient(object sender, RoutedEventArgs e)
    {
        var cfg = SelectedConfig ?? ConfigStore.Load().Configs.FirstOrDefault();
        if (cfg == null) { Status(Strings.Get("K_Empty")); return; }
        HandOff(cfg.Link);
    }

    private void HandOff(string link)
    {
        if (_clients.Count == 0) _clients = Clients.Detect();

        var client = _clients.Count == 1 ? _clients[0] : PickClient(_clients);
        var launched = client == null ? null : Clients.Launch(client, link);
        if (launched == null)
        {
            try { Clipboard.SetText(link); } catch { /* clipboard busy */ }
            Status(Strings.Get("K_NoClient"));
        }
        else
        {
            Status(string.Format(Strings.Get("K_ClientOpened"), launched));
        }
    }

    // Built in code rather than XAML: it is three controls and adding another
    // XAML file costs more than it saves.
    private FoundClient PickClient(List<FoundClient> clients)
    {
        var list = new ListBox
        {
            ItemsSource = clients,
            DisplayMemberPath = "Name",
            Background = new SolidColorBrush(Color.FromRgb(0x11, 0x18, 0x27)),
            Foreground = new SolidColorBrush(Color.FromRgb(0xE6, 0xED, 0xF3)),
            BorderThickness = new Thickness(0),
            SelectedIndex = 0,
        };
        var ok = new Button { Content = Strings.Get("K_Ok"), IsDefault = true, Padding = new Thickness(14, 7, 14, 7) };
        var cancel = new Button { Content = Strings.Get("K_Cancel"), IsCancel = true, Padding = new Thickness(14, 7, 14, 7), Margin = new Thickness(0, 0, 8, 0) };
        var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 12, 0, 0) };
        buttons.Children.Add(cancel);
        buttons.Children.Add(ok);
        var grid = new Grid { Margin = new Thickness(16) };
        grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        Grid.SetRow(list, 0); Grid.SetRow(buttons, 1);
        grid.Children.Add(list); grid.Children.Add(buttons);

        var win = new Window
        {
            Title = Strings.Get("K_OpenClient"),
            Width = 460, Height = 320, Owner = this,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Background = new SolidColorBrush(Color.FromRgb(0x0B, 0x0F, 0x17)),
            Foreground = new SolidColorBrush(Color.FromRgb(0xE6, 0xED, 0xF3)),
            Content = grid,
            FlowDirection = FlowDirection,
        };
        ok.Click += (_, _) => win.DialogResult = true;
        return win.ShowDialog() == true ? list.SelectedItem as FoundClient : null;
    }

    // ---- network ----

    private async void OnNetCheck(object sender, RoutedEventArgs e)
    {
        NetBtn.IsEnabled = false;
        Status(Strings.Get("K_NetRunning"));
        try
        {
            var verdict = await NetProbe.DiagnoseAsync();
            Status(Strings.Get("K_Verdict_" + verdict.Code));
            MessageBox.Show(this, FormatVerdict(verdict), Strings.Get("K_NetTitle"),
                MessageBoxButton.OK,
                verdict.Code == "normal" ? MessageBoxImage.Information : MessageBoxImage.Warning);
        }
        catch (Exception ex)
        {
            Status(ex.Message);
        }
        finally { NetBtn.IsEnabled = true; }
    }

    private string FormatVerdict(NetVerdict v)
    {
        var sb = new StringBuilder();
        sb.AppendLine(Strings.Get("K_Verdict_" + v.Code)).AppendLine();
        if (v.Code == "netmelli") sb.AppendLine(Strings.Get("K_NetMelliExplain")).AppendLine();

        foreach (var domestic in new[] { true, false })
        {
            sb.AppendLine(domestic ? Strings.Get("K_Domestic") : Strings.Get("K_International"));
            foreach (var r in v.Results.Where(r => r.Domestic == domestic))
            {
                var outcome = r.Ok
                    ? "OK  " + (r.Status == 204 ? "204" : r.Status.ToString())
                    : "FAIL " + (r.Status == 0 ? r.Error : r.Status.ToString());
                sb.AppendLine("  " + r.Host.PadRight(30) + outcome.PadRight(22) + r.Ms + " ms");
            }
            sb.AppendLine();
        }
        return sb.ToString().TrimEnd();
    }

    // ---- subscriptions ----

    private async Task RefreshSubscriptionAsync(SubscriptionItem sub)
    {
        RefreshBtn.IsEnabled = false;
        Status(Strings.Get("K_NetRunning"));
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(25) };
            http.DefaultRequestHeaders.UserAgent.ParseAdd("LuncherCompanion/1.0 (subscription)");
            // Raw links. ?b64=1 is not requested: ExtractLinks already handles a
            // base64 body, and asking for raw keeps a misconfigured panel visible.
            var body = await http.GetStringAsync(sub.Url);
            var links = ConfigStore.ExtractLinks(body);
            if (links.Count == 0)
            {
                Status(string.Format(Strings.Get("K_SubFailed"), Strings.Get("K_AddedNone")));
                return;
            }
            // Replace rather than accumulate, so a rotated credential does not
            // leave the old one behind looking usable.
            ConfigStore.DeleteSubscription(sub.Id);
            var kept = ConfigStore.AddSubscription(sub.Name, sub.Url);
            ConfigStore.AddLinks(links, kept.Id, kept.Name);
            ConfigStore.TouchSubscription(kept.Id, links.Count);
            Render();
            Status(string.Format(Strings.Get("K_AddedMany"), links.Count));
        }
        catch (Exception ex)
        {
            Status(string.Format(Strings.Get("K_SubFailed"),
                ex is HttpRequestException ? (ex.Message ?? ex.GetType().Name) : ex.GetType().Name));
        }
        finally { RefreshBtn.IsEnabled = true; }
    }

    private void OnRefreshSub(object sender, RoutedEventArgs e)
    {
        if (SelectedSub is SubscriptionItem s) _ = RefreshSubscriptionAsync(s);
    }

    private void OnCopySubUrl(object sender, RoutedEventArgs e)
    {
        if (SelectedSub is not SubscriptionItem s) return;
        try { Clipboard.SetText(s.Url); Status(Strings.Get("K_Copied")); }
        catch (Exception ex) { Status(ex.Message); }
    }

    private void OnDeleteSub(object sender, RoutedEventArgs e)
    {
        if (SelectedSub is not SubscriptionItem s) return;
        ConfigStore.DeleteSubscription(s.Id);
        Render();
        Status(Strings.Get("K_StatusReady"));
    }

    // ---- configs ----

    private void OnCopyConfig(object sender, RoutedEventArgs e)
    {
        if (SelectedConfig is not ConfigItem c) return;
        try { Clipboard.SetText(c.Link); Status(Strings.Get("K_Copied")); }
        catch (Exception ex) { Status(ex.Message); }
    }

    private void OnOpenConfig(object sender, RoutedEventArgs e)
    {
        if (SelectedConfig is ConfigItem c) HandOff(c.Link);
    }

    private void OnDeleteConfig(object sender, RoutedEventArgs e)
    {
        if (SelectedConfig is not ConfigItem c) return;
        ConfigStore.DeleteConfig(c.Id);
        Render();
        Status(Strings.Get("K_StatusReady"));
    }
}
